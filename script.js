// ═══════════════════════════════════════════════
// SUPABASE INIT
// ═══════════════════════════════════════════════
if (!window.mySupabase) {
    const SUPABASE_URL = 'https://vabvmrcihgkieqqktizq.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZhYnZtcmNpaGdraWVxcWt0aXpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5Mzc2MDcsImV4cCI6MjA4NDUxMzYwN30.rM0QOhtUM_D0Th1DkA0tsBZ9G2HfIB0Z6JMa_n_jCzs';
    window.mySupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log("Supabase chargé SAFE :", window.mySupabase ? "OUI" : "ÉCHEC");
}

// ═══════════════════════════════════════════════
// VARIABLES GLOBALES
// ═══════════════════════════════════════════════
let currentUser = null;
let currentGameId = null;
let isOnlineMode = false;
let myPlayerNumber = 1;
let opponentRoster = {};
let opponentDeck = [];
let allCards = [];
let roster = { starters: [], sixthMan: null };
let ownedCards = [];

let deck1 = [], deck2 = [];
let sixthMan1 = { name: "6e Homme J1", defense: 8, rebond: 8, attaque: 8, passe: 7, power: "clutch" };
let sixthMan2 = { name: "6e Homme J2", defense: 8, rebond: 7, attaque: 8, passe: 8, power: "clutch" };

let gameState = {
    round: 1, score1: 0, score2: 0, currentCategory: null,
    selectedPlayers: [], team1Selection: [], team2Selection: [],
    usedIndicesDeck1: [], usedIndicesDeck2: [],
    usageCountDeck1: [0,0,0,0,0], usageCountDeck2: [0,0,0,0,0],
    categoryChooser: 1, currentTurn: 1,
    sixthManUsed1: false, sixthManUsed2: false,
    isGameWinnerPhase: false,
    powersUsed1: {}, powersUsed2: {},
    bannedPlayers1: [], bannedPlayers2: [],
    activePowers: []
};

// ═══════════════════════════════════════════════
// CHARGEMENT DONNÉES
// ═══════════════════════════════════════════════
async function loadAllCardsAndCollection() {
    const { data: cards, error: cardsErr } = await window.mySupabase.from('cards').select('*');
    if (cardsErr) { console.error("Erreur chargement cartes :", cardsErr); return; }
    allCards = cards || [];

    if (currentUser) {
        const { data: coll, error: collErr } = await window.mySupabase
            .from('player_collections').select('roster, owned_cards').eq('user_id', currentUser.id).single();
        if (!collErr && coll) {
            ownedCards = coll.owned_cards || [];
            const savedRoster = coll.roster || { starters: [], sixthMan: null };
            // Nettoyer le roster : supprimer les joueurs qui ne sont pas dans owned_cards
            const ownedStrings = ownedCards.map(String);
            roster = {
                starters: (savedRoster.starters || []).filter(id => id && ownedStrings.includes(String(id))),
                sixthMan: savedRoster.sixthMan && ownedStrings.includes(String(savedRoster.sixthMan)) ? savedRoster.sixthMan : null
            };
        } else {
            await window.mySupabase.from('player_collections').insert({
                user_id: currentUser.id, owned_cards: [], roster: { starters: [], sixthMan: null }
            });
            roster = { starters: [], sixthMan: null };
            ownedCards = [];
        }
    }
}

// ═══════════════════════════════════════════════
// REALTIME MULTIJOUEUR
// ═══════════════════════════════════════════════
function initRealtime(gameId) {
    console.log("Démarrage realtime pour game ID :", gameId);
    const channel = window.mySupabase.channel(`game-realtime-${gameId}`);
    channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, (payload) => {
        const updated = payload.new;
        if (updated.status === 'in_progress') syncGameStateFromServer(updated);
        if (updated.player1_roster) { opponentRoster = updated.player1_roster; opponentDeck = opponentRoster.starters.map(id => allCards.find(c => String(c.id) === String(id))).filter(Boolean); sixthMan2 = allCards.find(c => String(c.id) === String(opponentRoster.sixthMan)) || {}; }
        if (updated.player2_roster) { opponentRoster = updated.player2_roster; opponentDeck = opponentRoster.starters.map(id => allCards.find(c => String(c.id) === String(id))).filter(Boolean); sixthMan2 = allCards.find(c => String(c.id) === String(opponentRoster.sixthMan)) || {}; }
        if (updated.player1_selection && myPlayerNumber === 2) gameState.team1Selection = updated.player1_selection;
        if (updated.player2_selection && myPlayerNumber === 1) gameState.team2Selection = updated.player2_selection;
        gameState.score1 = updated.score1 || gameState.score1;
        gameState.score2 = updated.score2 || gameState.score2;
        gameState.round = updated.round || gameState.round;
        gameState.currentCategory = updated.current_category || gameState.currentCategory;
        if (gameState.team1Selection.length > 0 && gameState.team2Selection.length > 0) showBattle();
    }).subscribe((status) => console.log("Statut realtime :", status));
}

// ═══════════════════════════════════════════════
// UTILITAIRES
// ═══════════════════════════════════════════════
function shuffleArray(array) { const a = [...array]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randomFloat(min, max) { return Math.random() * (max - min) + min; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

function calculateTeamStrength(deck) { return deck.reduce((s, p) => s + p.defense + p.rebond + p.attaque + p.passe, 0); }
function detectStrongerTeam() {
    const s1 = calculateTeamStrength(deck1), s2 = calculateTeamStrength(deck2);
    const difference = Math.abs(s1 - s2);
    if (difference >= 8) return { hasStrongerTeam: true, strongerTeam: s1 > s2 ? 1 : 2, weakerTeam: s1 > s2 ? 2 : 1, difference };
    return { hasStrongerTeam: false, strongerTeam: null, weakerTeam: null, difference };
}

// ═══════════════════════════════════════════════
// MODALES PERSONNALISÉES
// ═══════════════════════════════════════════════
function customConfirm(title, message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('customModal');
        document.getElementById('modalTitle').textContent = title;
        document.getElementById('modalMessage').textContent = message;
        document.getElementById('modalExtraContent').innerHTML = '';
        document.getElementById('modalButtons').innerHTML = `
            <button class="modal-btn modal-btn-confirm" onclick="closeModalWithResult(true)">✓ Confirmer</button>
            <button class="modal-btn modal-btn-cancel" onclick="closeModalWithResult(false)">✗ Annuler</button>`;
        modal.classList.add('show');
        window.closeModalWithResult = (result) => { modal.classList.remove('show'); resolve(result); delete window.closeModalWithResult; };
    });
}

function customAlert(title, message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('customModal');
        document.getElementById('modalTitle').textContent = title;
        document.getElementById('modalMessage').textContent = message;
        document.getElementById('modalExtraContent').innerHTML = '';
        document.getElementById('modalButtons').innerHTML = `<button class="modal-btn modal-btn-confirm" onclick="closeModalAlert()">OK</button>`;
        modal.classList.add('show');
        window.closeModalAlert = () => { modal.classList.remove('show'); resolve(); delete window.closeModalAlert; };
    });
}

function customPromptList(title, message, options) {
    return new Promise((resolve) => {
        const modal = document.getElementById('customModal');
        document.getElementById('modalTitle').textContent = title;
        document.getElementById('modalMessage').textContent = message;
        let listHTML = '<div class="modal-list">';
        options.forEach((option, index) => { listHTML += `<div class="modal-list-item" onclick="selectModalOption(${index})">${index + 1}. ${option.name}</div>`; });
        listHTML += '</div>';
        document.getElementById('modalExtraContent').innerHTML = listHTML;
        document.getElementById('modalButtons').innerHTML = `<button class="modal-btn modal-btn-cancel" onclick="selectModalOption(null)">✗ Annuler</button>`;
        modal.classList.add('show');
        window.selectModalOption = (index) => { modal.classList.remove('show'); resolve(index); delete window.selectModalOption; };
    });
}

function showModal(title, message, extraHTML = '', onConfirm = null, onCancel = null) {
    return new Promise((resolve) => {
        const modal = document.getElementById('powerModal');
        document.getElementById('modalTitle').textContent = title;
        document.getElementById('modalMessage').textContent = message;
        document.getElementById('modalExtra').innerHTML = extraHTML;
        modal.classList.add('show');
        const confirmBtn = document.getElementById('modalConfirm');
        const cancelBtn = document.getElementById('modalCancel');
        const handleConfirm = () => { modal.classList.remove('show'); confirmBtn.removeEventListener('click', handleConfirm); cancelBtn.removeEventListener('click', handleCancel); if (onConfirm) onConfirm(); resolve(true); };
        const handleCancel = () => { modal.classList.remove('show'); confirmBtn.removeEventListener('click', handleConfirm); cancelBtn.removeEventListener('click', handleCancel); if (onCancel) onCancel(); resolve(false); };
        confirmBtn.addEventListener('click', handleConfirm);
        cancelBtn.addEventListener('click', handleCancel);
    });
}

function showAlert(title, message) {
    const modal = document.getElementById('powerModal');
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalMessage').textContent = message;
    document.getElementById('modalExtra').innerHTML = '';
    const cancelBtn = document.getElementById('modalCancel');
    const confirmBtn = document.getElementById('modalConfirm');
    cancelBtn.style.display = 'none';
    confirmBtn.textContent = 'OK';
    modal.classList.add('show');
    const handleOk = () => { modal.classList.remove('show'); cancelBtn.style.display = ''; confirmBtn.textContent = 'Confirmer'; confirmBtn.removeEventListener('click', handleOk); };
    confirmBtn.addEventListener('click', handleOk);
}

// ═══════════════════════════════════════════════
// POUVOIRS
// ═══════════════════════════════════════════════
async function activatePower(playerIndex, power, team) {
    if (team === 1) gameState.powersUsed1[playerIndex] = true;
    else gameState.powersUsed2[playerIndex] = true;

    switch(power) {
        case 'clutch':
            if (gameState.round === 4 || gameState.isGameWinnerPhase) {
                gameState.activePowers.push({ type: 'clutch', playerIndex, team });
                await customAlert('🔥 Pouvoir CLUTCH', '+1 à la stat choisie pour ce joueur!');
            } else {
                await customAlert('⚠️ Erreur', 'Le pouvoir CLUTCH ne peut être utilisé qu\'au 4e quart-temps ou en Game Winner!');
                if (team === 1) delete gameState.powersUsed1[playerIndex]; else delete gameState.powersUsed2[playerIndex];
                return false;
            }
            break;
        case 'agressif':
            const opponentTeam = team === 1 ? 2 : 1;
            const oppDeck = opponentTeam === 1 ? deck1 : deck2;
            const allOpponentPlayers = oppDeck.map((p, i) => ({ index: i, name: p.name }));
            const choiceNum = await customPromptList('💪 Pouvoir AGRESSIF', 'Choisissez N\'IMPORTE QUEL joueur adverse à bannir:', allOpponentPlayers);
            if (choiceNum !== null && choiceNum >= 0 && choiceNum < allOpponentPlayers.length) {
                const bannedIndex = allOpponentPlayers[choiceNum].index;
                if (opponentTeam === 1) gameState.bannedPlayers1.push(bannedIndex); else gameState.bannedPlayers2.push(bannedIndex);
                await customAlert('💪 Pouvoir AGRESSIF', 'Un joueur adverse a été banni en secret!');
            } else {
                await customAlert('⚠️ Annulé', 'Bannissement annulé');
                if (team === 1) delete gameState.powersUsed1[playerIndex]; else delete gameState.powersUsed2[playerIndex];
                return false;
            }
            break;
        case 'passeur':
            gameState.activePowers.push({ type: 'passeur', playerIndex, team });
            await customAlert('🎯 Pouvoir PASSEUR', '+2 à la 2ème carte si Passe ou Attaque choisie!');
            break;
        case 'defenseur':
            gameState.activePowers.push({ type: 'defenseur', playerIndex, team });
            await customAlert('🛡️ Pouvoir DÉFENSEUR', '+2 à la 2ème carte si Défense ou Rebond choisi!');
            break;
    }

    const allCardEls = document.querySelectorAll('.player-card');
    const deck = team === 1 ? deck1 : deck2;
    const playerData = playerIndex === 'sixthman' ? (team === 1 ? sixthMan1 : sixthMan2) : deck[playerIndex];
    allCardEls.forEach(card => {
        if (card.classList.contains('selected')) {
            const cardName = card.querySelector('.player-name');
            if (cardName && cardName.textContent === playerData.name) card.classList.add('power-locked');
        }
    });

    updateSelectionCounter();
    updateConfirmButton();
    return true;
}

document.addEventListener('click', async function(e) {
    let powerIcon = e.target;
    if (!powerIcon.classList.contains('power-icon')) powerIcon = e.target.closest('.power-icon');
    if (powerIcon && powerIcon.classList.contains('power-icon')) {
        e.stopPropagation(); e.preventDefault();
        powerIcon.style.transform = 'scale(1.3)';
        powerIcon.style.boxShadow = '0 0 30px rgba(255, 215, 0, 1)';
        setTimeout(() => { powerIcon.style.transform = ''; powerIcon.style.boxShadow = ''; }, 200);
        if (powerIcon.classList.contains('power-used')) { showAlert('⚠️ Déjà utilisé', 'Ce pouvoir a déjà été utilisé!'); return; }
        const playerIndex = powerIcon.dataset.playerIndex;
        const power = powerIcon.dataset.power;
        const team = gameState.currentTurn;
        const powerDescriptions = {
            clutch: "🔥 CLUTCH: +1 à la stat (uniquement 4e quart ou Game Winner)",
            agressif: "💪 AGRESSIF: Bannir un joueur adverse pour ce quart",
            passeur: "🎯 PASSEUR: +2 à la 2ème carte si Passe ou Attaque",
            defenseur: "🛡️ DÉFENSEUR: +2 à la 2ème carte si Défense ou Rebond"
        };
        const confirmed = await customConfirm('Activer Pouvoir?', powerDescriptions[power]);
        if (confirmed) {
            if (await activatePower(playerIndex, power, team)) {
                powerIcon.classList.add('power-used');
                powerIcon.classList.add('power-active');
            }
        }
    }
}, true);

// ═══════════════════════════════════════════════
// LOGIQUE DE JEU
// ═══════════════════════════════════════════════
function getFirstPlayer() {
    if (gameState.round === 1 || gameState.round === 3) return 1;
    if (gameState.round === 2) return 2;
    if (gameState.round === 4) return gameState.score1 < gameState.score2 ? 1 : 2;
    if (gameState.round === 5) return gameState.categoryChooser;
    return 1;
}

document.getElementById('defenseBtn').addEventListener('click', () => selectCategory('defense'));
document.getElementById('rebondBtn').addEventListener('click',  () => selectCategory('rebond'));
document.getElementById('attaqueBtn').addEventListener('click', () => selectCategory('attaque'));
document.getElementById('passeBtn').addEventListener('click',   () => selectCategory('passe'));
document.getElementById('confirmBtn').addEventListener('click', confirmSelection);

document.getElementById('playBtn').addEventListener('click', function() {
    deck1 = roster.starters.map(id => allCards.find(c => String(c.id) === String(id))).filter(Boolean);
    sixthMan1 = allCards.find(c => String(c.id) === String(roster.sixthMan)) || { name: "6e Homme par défaut", defense: 7, rebond: 7, attaque: 7, passe: 7, power: "clutch", position: "?" };
    deck2 = deck1.map(card => ({ ...card }));
    sixthMan2 = { ...sixthMan1 };
    document.getElementById('mainMenu').style.display = 'none';
    document.querySelector('.game-container').style.display = 'block';
    startGame();
});

function syncGameStateFromServer(serverState) {
    gameState.status = serverState.status || gameState.status;
    gameState.currentTurn = serverState.currentTurn;
    if (gameState.status === 'in_progress') {
        document.getElementById('waitingRoom').style.display = 'none';
        startGame();
    } else if (gameState.status === 'waiting') {
        document.getElementById('waitingRoom').style.display = 'block';
    }
}

function startGame() {
    if (isOnlineMode) {
        deck1 = roster.starters.map(id => allCards.find(c => String(c.id) === String(id))).filter(Boolean);
        sixthMan1 = allCards.find(c => String(c.id) === String(roster.sixthMan)) || {};
        deck2 = opponentDeck;
        sixthMan2 = allCards.find(c => String(c.id) === String(opponentRoster?.sixthMan)) || {};
    } else {
        deck1 = roster.starters.map(id => allCards.find(c => String(c.id) === String(id))).filter(Boolean);
        sixthMan1 = allCards.find(c => String(c.id) === String(roster.sixthMan)) || {};
        deck2 = deck1.map(card => ({ ...card }));
        sixthMan2 = { ...sixthMan1 };
    }
    showIntro();
}

function showIntro() {
    const introAnimation = document.getElementById('introAnimation');
    const teamPresentation = document.getElementById('teamPresentation');
    const introCardsGrid = document.getElementById('introCardsGrid');
    const introContinueBtn = document.getElementById('introContinueBtn');

    // Afficher l'intro
    introAnimation.classList.remove('hide');
    introCardsGrid.innerHTML = '';
    teamPresentation.classList.remove('show');
    introContinueBtn.classList.remove('show');

    setTimeout(() => {
        teamPresentation.classList.add('show');
        showTeamCards(deck1, 1);
        setTimeout(() => introContinueBtn.classList.add('show'), deck1.length * 200 + 500);
    }, 500);

    introContinueBtn.onclick = function() {
        introCardsGrid.innerHTML = '';
        introContinueBtn.classList.remove('show');
        const teamHeader = document.getElementById('teamHeader');
        teamHeader.textContent = 'JOUEUR 2';
        teamHeader.className = 'team-header player2';
        showTeamCards(deck2, 2);
        setTimeout(() => introContinueBtn.classList.add('show'), deck2.length * 200 + 500);
        introContinueBtn.onclick = function() {
            introAnimation.classList.add('hide');
            setTimeout(() => {
                if (gameState.round === 3) {
                    const categories = ['defense', 'rebond', 'attaque', 'passe'];
                    gameState.currentCategory = categories[Math.floor(Math.random() * categories.length)];
                }
                showPlayerSelection(getFirstPlayer());
            }, 500);
        };
    };
}

function showTeamCards(deck, player) {
    const introCardsGrid = document.getElementById('introCardsGrid');
    const teamHeader = document.getElementById('teamHeader');
    if (player === 1) { teamHeader.textContent = 'JOUEUR 1'; teamHeader.className = 'team-header player1'; }
    deck.forEach((playerData, index) => {
        setTimeout(() => {
            const card = renderCard(playerData, { size: 'normal' });
            card.classList.add('intro-card');
            card.style.opacity = '0';
            card.style.transform = 'scale(0.8) rotateY(180deg)';
            card.style.transition = 'all 0.6s ease-out';
            introCardsGrid.appendChild(card);
            setTimeout(() => {
                card.style.opacity = '1';
                card.style.transform = 'scale(1) rotateY(0deg)';
            }, 50);
        }, index * 200);
    });
}

function updateRoundInfo() {
    const firstPlayer = getFirstPlayer();
    let info = '';
    if (gameState.isGameWinnerPhase) {
        const scoreDiff = gameState.score1 - gameState.score2;
        if (scoreDiff === 0) info = `⚡ GAME WINNER - Égalité - Catégorie aléatoire`;
        else {
            const leadingPlayer = gameState.score1 > gameState.score2 ? 1 : 2;
            const trailingPlayer = leadingPlayer === 1 ? 2 : 1;
            if (gameState.currentTurn === leadingPlayer) info = `⚡ GAME WINNER - Joueur ${leadingPlayer} (en avance) choisit la catégorie et son joueur`;
            else info = `⚡ GAME WINNER - Joueur ${trailingPlayer} (en retard) choisit son joueur ou le 6e homme`;
        }
    } else {
        info = `Manche ${gameState.round} - `;
        if (gameState.currentTurn === firstPlayer) info += `Joueur ${firstPlayer} choisit ${gameState.round === 3 ? '(catégorie aléatoire)' : 'la catégorie et ses joueurs'}`;
        else info += `Joueur ${gameState.currentTurn} choisit ses joueurs`;
    }
    document.getElementById('roundInfo').textContent = info;
}

function showPlayerSelection(player) {
    gameState.currentTurn = player;
    const isMyTurn = (myPlayerNumber === player);

    if (!isMyTurn && isOnlineMode) {
        document.getElementById('roundInfo').textContent = `Attente de Joueur ${player}...`;
        document.getElementById('playersGrid').innerHTML = '<div style="text-align:center; padding:60px; font-size:24px;">Adversaire choisit...</div>';
        document.getElementById('confirmBtn').disabled = true;
        document.querySelectorAll('.category-btn').forEach(b => b.classList.add('disabled'));
        return;
    }

    gameState.selectedPlayers = [];
    const firstPlayer = getFirstPlayer();
    const deck = (myPlayerNumber === 1) ? deck1 : deck2;
    const usedIndices = myPlayerNumber === 1 ? gameState.usedIndicesDeck1 : gameState.usedIndicesDeck2;
    const usageCount = myPlayerNumber === 1 ? gameState.usageCountDeck1 : gameState.usageCountDeck2;

    document.getElementById('deckTitle').textContent = `Deck Joueur ${myPlayerNumber}`;
    updateRoundInfo();

    const playersGrid = document.getElementById('playersGrid');
    playersGrid.innerHTML = '';

    deck.forEach((playerData, index) => {
        const isUsedInThisRound = usedIndices.includes(index);
        const hasReachedLimit = usageCount[index] >= 2;
        const isDisabled = isUsedInThisRound || hasReachedLimit;
        const powerUsed = myPlayerNumber === 1 ? gameState.powersUsed1[index] : gameState.powersUsed2[index];
        const card = renderCard(playerData, {
            disabled:    isDisabled,
            powerUsed:   powerUsed,
            showPower:   true,
            playerIndex: index,
            usageCount:  usageCount[index],
        });
        if (!isDisabled) card.addEventListener('click', () => togglePlayerSelection(index, card));
        playersGrid.appendChild(card);
    });

    if (gameState.isGameWinnerPhase) {
        const sixthManUsed = myPlayerNumber === 1 ? gameState.sixthManUsed1 : gameState.sixthManUsed2;
        const sixthMan = myPlayerNumber === 1 ? sixthMan1 : sixthMan2;
        const scoreDiff = gameState.score1 - gameState.score2;
        const canUseSixthMan = (myPlayerNumber === 1 && scoreDiff <= 0) || (myPlayerNumber === 2 && scoreDiff >= 0);
        if (canUseSixthMan && !sixthManUsed) {
            const powerUsedSM = myPlayerNumber === 1 ? gameState.powersUsed1['sixthman'] : gameState.powersUsed2['sixthman'];
            const card = renderCard(sixthMan, {
                isSixthMan:  true,
                powerUsed:   powerUsedSM,
                showPower:   true,
                playerIndex: 'sixthman',
            });
            card.addEventListener('click', () => toggleSixthManSelection(myPlayerNumber, card));
            playersGrid.appendChild(card);
        }
    }

    let canChooseCategory = false;
    if (gameState.isGameWinnerPhase) {
        const scoreDiff = gameState.score1 - gameState.score2;
        if (scoreDiff !== 0) { const leadingPlayer = gameState.score1 > gameState.score2 ? 1 : 2; canChooseCategory = (myPlayerNumber === leadingPlayer && !gameState.currentCategory); }
    } else {
        canChooseCategory = (player === firstPlayer && !gameState.currentCategory);
    }

    document.querySelectorAll('.category-btn').forEach(btn => {
        btn.classList.remove('selected');
        if (canChooseCategory) btn.classList.remove('disabled'); else btn.classList.add('disabled');
    });

    if (gameState.currentCategory) {
        const categoryMap = { 'defense': 'defenseBtn', 'rebond': 'rebondBtn', 'attaque': 'attaqueBtn', 'passe': 'passeBtn' };
        const btnToSelect = document.getElementById(categoryMap[gameState.currentCategory]);
        if (btnToSelect) btnToSelect.classList.add('selected');
    }

    updateSelectionCounter();
    updateConfirmButton();
}

const powerEmojis = { clutch: '🔥', agressif: '💪', passeur: '🎯', defenseur: '🛡️' };
const powerNames  = { clutch: 'Clutch', agressif: 'Agressif', passeur: 'Passeur', defenseur: 'Défenseur' };

// ═══════════════════════════════════════════════
// RENDU DES CARTES — CONSTANTES
// ═══════════════════════════════════════════════
const CARD_TEMPLATE_BASE = 'https://vabvmrcihgkieqqktizq.supabase.co/storage/v1/object/public/Animpack/';
const BADGE_ATT = 'https://vabvmrcihgkieqqktizq.supabase.co/storage/v1/object/public/fonts/attaque.png';
const BADGE_DEF = 'https://vabvmrcihgkieqqktizq.supabase.co/storage/v1/object/public/fonts/defense.png';
const BADGE_PAS = 'https://vabvmrcihgkieqqktizq.supabase.co/storage/v1/object/public/fonts/passe.png';
const BADGE_REB = 'https://vabvmrcihgkieqqktizq.supabase.co/storage/v1/object/public/fonts/rebond.png';

// Positions validées
const CARD_POS = {
    photoTop: 27.3, photoH: 47.9, photoW: 97.3,
    attTop: 68.4, attL: 1.6, attW: 20,   attH: 6.8, attST: 71.8, attSL: 7,
    defTop: 68.4, defR: 1.3, defW: 20.5, defH: 6.8, defST: 71.8, defSR: 7.4,
    pasTop: 80.7, pasL: 1.6, pasW: 20.5, pasH: 6.8, pasST: 84,   pasSL: 7,
    rebTop: 80.7, rebR: 1.3, rebW: 20.5, rebH: 6.8, rebST: 84,   rebSR: 7.4,
    nameTop: 77.9, nameW: 90, statSize: 18
};

function dizOffset(val) { return parseInt(val) >= 10 ? 0.2 : 0; }

function adaptiveFontSize(name) {
    const len = name.length;
    if (len <= 20) return 18;
    if (len <= 21) return 17;
    if (len <= 22) return 16;
    return 15;
}

// Retourne le fond PNG selon l'équipe
// Pour l'instant : fondvierge.png pour tous, à remplacer par team_bg_map[team] quand tu auras les fonds par équipe
const TEAM_BG_MAP = {};
function getTeamBg(team) {
    return TEAM_BG_MAP[team] || (CARD_TEMPLATE_BASE + 'fondvierge.png');
}

// ═══════════════════════════════════════════════
// renderCard(playerData, options)
// Retourne un élément DOM .player-card prêt à insérer
// options: { selected, disabled, powerUsed, powerLocked, showPower, playerIndex, isSixthMan, size }
// Tailles disponibles : 'small' (150×222) | 'normal' (200×296) | 'large' (260×385)
// Toutes les polices sont en em, proportionnelles à la carte
// ═══════════════════════════════════════════════
function renderCard(playerData, options = {}) {
    const {
        selected     = false,
        disabled     = false,
        powerUsed    = false,
        powerLocked  = false,
        showPower    = false,
        playerIndex  = null,
        isSixthMan   = false,
        size         = 'normal'
    } = options;

    // Dimensions selon taille
    const SIZES = {
        small:  { w: 150, h: 222,  statPx: 13, namePx: 11, scale: 150/200 },
        normal: { w: 200, h: 296,  statPx: 18, namePx: 15, scale: 1       },
        large:  { w: 260, h: 385,  statPx: 23, namePx: 19, scale: 260/200 },
    };
    const sz   = SIZES[size] || SIZES.normal;
    const cardW = sz.w;
    const cardH = sz.h;
    const sc    = sz.scale;  // facteur d'échelle pour les polices

    const wrap = document.createElement('div');
    wrap.className = [
        'player-card',
        disabled    ? 'disabled'     : '',
        selected    ? 'selected'     : '',
        powerLocked ? 'power-locked' : '',
        isSixthMan  ? 'sixth-man'    : '',
    ].filter(Boolean).join(' ');

    wrap.style.cssText = `
        position: relative;
        width: ${cardW}px;
        height: ${cardH}px;
        border-radius: 10px;
        overflow: hidden;
        cursor: ${disabled ? 'not-allowed' : 'pointer'};
        opacity: ${disabled ? '0.4' : '1'};
        transition: transform 0.2s, box-shadow 0.2s;
        flex-shrink: 0;
        ${selected    ? 'transform:scale(1.05); box-shadow:0 0 0 3px #f5576c, 0 8px 24px rgba(0,0,0,0.5);' : ''}
        ${powerLocked ? 'box-shadow:0 0 0 3px #FFD700, 0 0 20px rgba(255,215,0,0.4);' : ''}
        ${isSixthMan  ? 'box-shadow:0 0 0 3px gold, 0 0 16px rgba(255,215,0,0.3);' : ''}
    `;

    // ── Carte PREMIUM : PNG custom affiché tel quel ──
    if (playerData.card_type === 'premium') {
        const img = document.createElement('img');
        img.src = playerData.image_url || '';
        img.alt = playerData.name;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;border-radius:10px;';
        wrap.appendChild(img);
        if (showPower) _appendPowerBadge(wrap, playerData, powerUsed, playerIndex, cardW);
        return wrap;
    }

    // ── z1 : fond PNG équipe ──
    const bg = document.createElement('img');
    bg.src = getTeamBg(playerData.team);
    bg.alt = '';
    bg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:fill;z-index:1;';
    wrap.appendChild(bg);

    // ── z2 : photo joueur ──
    if (playerData.image_url) {
        const photo = document.createElement('img');
        photo.src = playerData.image_url;
        photo.alt = playerData.name;
        photo.onerror = () => { photo.style.display = 'none'; };
        photo.style.cssText = `
            position:absolute;
            top:${CARD_POS.photoTop}%;
            left:50%;
            transform:translateX(-50%);
            width:${CARD_POS.photoW}%;
            height:${CARD_POS.photoH}%;
            object-fit:cover;
            object-position:top center;
            z-index:2;
        `;
        wrap.appendChild(photo);
    }

    // ── z3 : 4 badges PNG ──
    const badges = [
        { src: BADGE_ATT, top: CARD_POS.attTop, side: 'left',  sideVal: CARD_POS.attL, w: CARD_POS.attW, h: CARD_POS.attH },
        { src: BADGE_DEF, top: CARD_POS.defTop, side: 'right', sideVal: CARD_POS.defR, w: CARD_POS.defW, h: CARD_POS.defH },
        { src: BADGE_PAS, top: CARD_POS.pasTop, side: 'left',  sideVal: CARD_POS.pasL, w: CARD_POS.pasW, h: CARD_POS.pasH },
        { src: BADGE_REB, top: CARD_POS.rebTop, side: 'right', sideVal: CARD_POS.rebR, w: CARD_POS.rebW, h: CARD_POS.rebH },
    ];
    badges.forEach(b => {
        const img = document.createElement('img');
        img.src = b.src;
        img.alt = '';
        img.style.cssText = `
            position:absolute;
            top:${b.top}%;
            ${b.side}:${b.sideVal}%;
            width:${b.w}%;
            height:${b.h}%;
            object-fit:fill;
            z-index:3;
        `;
        wrap.appendChild(img);
    });

    // ── z4 : chiffres des stats ──
    const stats = [
        { val: playerData.attaque,  top: CARD_POS.attST, side: 'left',  offset: CARD_POS.attSL },
        { val: playerData.defense,  top: CARD_POS.defST, side: 'right', offset: CARD_POS.defSR },
        { val: playerData.passe,    top: CARD_POS.pasST, side: 'left',  offset: CARD_POS.pasSL },
        { val: playerData.rebond,   top: CARD_POS.rebST, side: 'right', offset: CARD_POS.rebSR },
    ];
    stats.forEach(s => {
        const el = document.createElement('div');
        el.textContent = s.val ?? '?';
        const adj = dizOffset(s.val);
        el.style.cssText = `
            position:absolute;
            top:${s.top}%;
            ${s.side}:${s.offset - adj}%;
            font-family:'Berlin Sans FB','Arial Black',sans-serif;
            font-size:${Math.round(CARD_POS.statSize * sc)}px;
            font-weight:normal;
            color:#fff;
            line-height:1;
            transform:translateY(-50%);
            pointer-events:none;
            z-index:4;
        `;
        wrap.appendChild(el);
    });

    // ── z4 : nom du joueur ──
    const nameEl = document.createElement('div');
    nameEl.textContent = playerData.name;
    const baseFontSize = adaptiveFontSize(playerData.name);
    nameEl.style.cssText = `
        position:absolute;
        top:${CARD_POS.nameTop}%;
        left:50%;
        transform:translate(-50%,-50%);
        width:${CARD_POS.nameW}%;
        text-align:center;
        font-family:'Eras Demi ITC','Trebuchet MS',sans-serif;
        font-size:${Math.round(baseFontSize * sc)}px;
        font-weight:normal;
        color:#fff;
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
        pointer-events:none;
        z-index:4;
    `;
    wrap.appendChild(nameEl);

    // ── z4 : badge usage (Utilisé X/2) ──
    if (options.usageCount !== undefined) {
        const usage = document.createElement('div');
        usage.textContent = `${options.usageCount}/2`;
        usage.style.cssText = `
            position:absolute; top:4px; right:6px;
            font-size:10px; color:${options.usageCount >= 2 ? '#ff4444' : 'rgba(255,255,255,0.6)'};
            font-weight:bold; z-index:5; pointer-events:none;
            text-shadow:0 1px 3px rgba(0,0,0,0.8);
        `;
        wrap.appendChild(usage);
    }

    // ── Badge pouvoir ──
    if (showPower) _appendPowerBadge(wrap, playerData, powerUsed, playerIndex, cardW);

    return wrap;
}

function _appendPowerBadge(wrap, playerData, powerUsed, playerIndex, cardW) {
    if (!playerData.power) return;
    const powerColors = {
        clutch:    { bg: 'linear-gradient(135deg,#FFD700,#FFA500)', color: '#000' },
        agressif:  { bg: 'linear-gradient(135deg,#ff0000,#cc0000)', color: '#fff' },
        passeur:   { bg: 'linear-gradient(135deg,#00bfff,#0080ff)', color: '#fff' },
        defenseur: { bg: 'linear-gradient(135deg,#32cd32,#228b22)', color: '#fff' },
    };
    const pNames = { clutch:'🔥 Clutch', agressif:'💪 Agressif', passeur:'🎯 Passeur', defenseur:'🛡️ Défenseur' };
    const pc = powerColors[playerData.power] || { bg:'#666', color:'#fff' };
    const badge = document.createElement('div');
    badge.className = `power-icon power-${playerData.power} ${powerUsed ? 'power-used' : ''}`;
    badge.dataset.playerIndex = playerIndex;
    badge.dataset.power = playerData.power;
    badge.textContent = pNames[playerData.power] || playerData.power;
    badge.style.cssText = `
        position:absolute; bottom:5px; left:50%; transform:translateX(-50%);
        background:${powerUsed ? '#555' : pc.bg};
        color:${pc.color};
        padding:2px 8px; border-radius:4px;
        font-size:10px; font-weight:bold; white-space:nowrap;
        opacity:${powerUsed ? 0.4 : 1};
        cursor:${powerUsed ? 'not-allowed' : 'pointer'};
        pointer-events:auto; z-index:5;
    `;
    wrap.appendChild(badge);
}



function selectCategory(category) {
    const categoryMap = { 'defense': 'defenseBtn', 'rebond': 'rebondBtn', 'attaque': 'attaqueBtn', 'passe': 'passeBtn' };
    const btn = document.getElementById(categoryMap[category]);
    if (btn && btn.classList.contains('disabled')) return;
    gameState.currentCategory = category;
    document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('selected'));
    if (btn) btn.classList.add('selected');
    updateConfirmButton();
}

function toggleFullscreen() {
    if (!document.fullscreenElement) { document.documentElement.requestFullscreen(); document.getElementById('fullscreenBtn').textContent = '✕ Quitter plein écran'; }
    else { document.exitFullscreen(); document.getElementById('fullscreenBtn').textContent = '⛶ Plein écran'; }
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) document.getElementById('fullscreenBtn').textContent = '⛶ Plein écran'; });

function togglePlayerSelection(index, card) {
    if (card.classList.contains('power-locked')) return;
    const playerIndex = gameState.selectedPlayers.indexOf(index);
    const maxPlayers = gameState.isGameWinnerPhase ? 1 : 2;
    if (playerIndex > -1) {
        gameState.selectedPlayers.splice(playerIndex, 1);
        card.classList.remove('selected');
        const powerIcon = card.querySelector('.power-icon');
        if (powerIcon) powerIcon.classList.remove('show');
    } else {
        if (gameState.selectedPlayers.length >= maxPlayers) return;
        gameState.selectedPlayers.push(index);
        card.classList.add('selected');
        const powerIcon = card.querySelector('.power-icon');
        if (powerIcon && !powerIcon.classList.contains('power-used')) powerIcon.classList.add('show');
    }
    updateSelectionCounter();
    updateConfirmButton();
}

function updateSelectionCounter() {
    const maxPlayers = gameState.isGameWinnerPhase ? 1 : 2;
    const current = gameState.selectedPlayers.length;
    const counter = document.getElementById('selectionCounter');
    if (counter) {
        counter.textContent = `Joueurs sélectionnés: ${current}/${maxPlayers}`;
        if (current === 0) counter.style.color = '#999';
        else if (current < maxPlayers) counter.style.color = '#FFA500';
        else counter.style.color = '#4CAF50';
    }
}

function updateConfirmButton() {
    if (gameState.isGameWinnerPhase) document.getElementById('confirmBtn').disabled = gameState.selectedPlayers.length !== 1 || !gameState.currentCategory;
    else document.getElementById('confirmBtn').disabled = gameState.selectedPlayers.length !== 2 || !gameState.currentCategory;
}

function toggleSixthManSelection(player, card) {
    document.querySelectorAll('.player-card').forEach(c => c.classList.remove('selected'));
    gameState.selectedPlayers = ['sixthman'];
    card.classList.add('selected');
    updateConfirmButton();
}

async function confirmSelection() {
    if (gameState.isGameWinnerPhase) {
        const scoreDiff = gameState.score1 - gameState.score2;
        let firstPlayer = scoreDiff === 0 ? 1 : (scoreDiff > 0 ? 1 : 2);
        let secondPlayer = firstPlayer === 1 ? 2 : 1;
        if (gameState.currentTurn === firstPlayer) {
            if (firstPlayer === myPlayerNumber) { gameState.team1Selection = gameState.selectedPlayers[0] === 'sixthman' ? ['sixthman'] : [...gameState.selectedPlayers]; if (gameState.selectedPlayers[0] === 'sixthman') gameState.sixthManUsed1 = true; }
            else { gameState.team2Selection = gameState.selectedPlayers[0] === 'sixthman' ? ['sixthman'] : [...gameState.selectedPlayers]; if (gameState.selectedPlayers[0] === 'sixthman') gameState.sixthManUsed2 = true; }
            setTimeout(() => showPlayerSelection(secondPlayer), 300);
        } else {
            if (secondPlayer === myPlayerNumber) { gameState.team1Selection = gameState.selectedPlayers[0] === 'sixthman' ? ['sixthman'] : [...gameState.selectedPlayers]; if (gameState.selectedPlayers[0] === 'sixthman') gameState.sixthManUsed1 = true; }
            else { gameState.team2Selection = gameState.selectedPlayers[0] === 'sixthman' ? ['sixthman'] : [...gameState.selectedPlayers]; if (gameState.selectedPlayers[0] === 'sixthman') gameState.sixthManUsed2 = true; }
            showBattle();
        }
        return;
    }

    const firstPlayer = getFirstPlayer();
    const secondPlayer = firstPlayer === 1 ? 2 : 1;
    if (gameState.currentTurn === firstPlayer) {
        if (firstPlayer === myPlayerNumber) {
            gameState.team1Selection = gameState.selectedPlayers[0] === 'sixthman' ? ['sixthman'] : [...gameState.selectedPlayers];
            if (gameState.selectedPlayers[0] === 'sixthman') { if (myPlayerNumber === 1) gameState.sixthManUsed1 = true; else gameState.sixthManUsed2 = true; }
        }
        setTimeout(() => showPlayerSelection(secondPlayer), 300);
    } else {
        if (secondPlayer === myPlayerNumber) {
            gameState.team1Selection = gameState.selectedPlayers[0] === 'sixthman' ? ['sixthman'] : [...gameState.selectedPlayers];
            if (gameState.selectedPlayers[0] === 'sixthman') { if (myPlayerNumber === 1) gameState.sixthManUsed1 = true; else gameState.sixthManUsed2 = true; }
        } else {
            gameState.team2Selection = gameState.selectedPlayers[0] === 'sixthman' ? ['sixthman'] : [...gameState.selectedPlayers];
            if (gameState.selectedPlayers[0] === 'sixthman') { if (myPlayerNumber === 1) gameState.sixthManUsed1 = true; else gameState.sixthManUsed2 = true; }
        }
        showBattle();
    }

    if (isOnlineMode) {
        const field = myPlayerNumber === 1 ? 'player1_selection' : 'player2_selection';
        await window.mySupabase.from('games').update({ [field]: gameState.selectedPlayers }).eq('id', currentGameId);
    }
}

function showReplacementAnimation(bannedPlayer, sixthMan) {
    return new Promise(resolve => {
        const animation = document.getElementById('replacementAnimation');
        document.getElementById('bannedCard').innerHTML = `
            <div style="font-size:24px; font-weight:bold; margin-bottom:15px; color:#ff0000;">❌ BANNI</div>
            <div style="font-size:20px; font-weight:bold; margin-bottom:10px;">${bannedPlayer.name}</div>
            <div style="font-size:14px; color:#666; margin-bottom:8px;">${bannedPlayer.team}</div>
            <div style="font-size:13px; line-height:1.6;">🛡️ ${bannedPlayer.defense} | 🏀 ${bannedPlayer.rebond}<br>⚡ ${bannedPlayer.attaque} | 🎯 ${bannedPlayer.passe}</div>`;
        document.getElementById('sixthmanCard').innerHTML = `
            <div style="font-size:24px; font-weight:bold; margin-bottom:15px; color:#FFD700;">⭐ REMPLAÇANT</div>
            <div style="font-size:20px; font-weight:bold; margin-bottom:10px;">${sixthMan.name}</div>
            <div style="font-size:13px; line-height:1.6;">🛡️ ${sixthMan.defense} | 🏀 ${sixthMan.rebond}<br>⚡ ${sixthMan.attaque} | 🎯 ${sixthMan.passe}</div>`;
        animation.classList.add('show');
        setTimeout(() => { animation.classList.remove('show'); resolve(); }, 3000);
    });
}

async function showBattle() {
    for (let i = 0; i < gameState.team1Selection.length; i++) {
        const playerIdx = gameState.team1Selection[i];
        if (typeof playerIdx === 'number' && gameState.bannedPlayers1.includes(playerIdx)) {
            await showReplacementAnimation(deck1[playerIdx], sixthMan1);
            gameState.team1Selection[i] = 'sixthman'; gameState.sixthManUsed1 = true;
            gameState.activePowers = gameState.activePowers.filter(p => !(p.team === 1 && p.playerIndex === playerIdx));
        }
    }
    for (let i = 0; i < gameState.team2Selection.length; i++) {
        const playerIdx = gameState.team2Selection[i];
        if (typeof playerIdx === 'number' && gameState.bannedPlayers2.includes(playerIdx)) {
            await showReplacementAnimation(deck2[playerIdx], sixthMan2);
            gameState.team2Selection[i] = 'sixthman'; gameState.sixthManUsed2 = true;
            gameState.activePowers = gameState.activePowers.filter(p => !(p.team === 2 && p.playerIndex === playerIdx));
        }
    }

    const battleAnimation = document.getElementById('battleAnimation');
    const battle1Cards = document.getElementById('battle1Cards');
    const battle2Cards = document.getElementById('battle2Cards');
    const battle1Total = document.getElementById('battle1Total');
    const battle2Total = document.getElementById('battle2Total');
    const winnerAnnouncement = document.getElementById('winnerAnnouncement');
    battle1Cards.innerHTML = ''; battle2Cards.innerHTML = '';
    battle1Total.textContent = '0'; battle2Total.textContent = '0';
    battle1Total.classList.remove('show'); battle2Total.classList.remove('show');
    winnerAnnouncement.classList.remove('show', 'player1', 'player2');
    const categoryNames = { defense: 'DÉFENSE', rebond: 'REBOND', attaque: 'ATTAQUE', passe: 'PASSE' };
    document.getElementById('battleHeader').textContent = `Catégorie: ${categoryNames[gameState.currentCategory]}`;
    battleAnimation.classList.add('show');

    let total1 = 0, total2 = 0;
    setTimeout(() => {
        gameState.team1Selection.forEach((item, i) => {
            setTimeout(() => {
                const player = item === 'sixthman' ? sixthMan1 : deck1[item];
                let stat = player[gameState.currentCategory];
                gameState.activePowers.forEach(ap => {
                    if (ap.team === 1 && ap.playerIndex === item && ap.type === 'clutch') stat += 1;
                    if (ap.team === 1 && i === 1) {
                        if (ap.type === 'passeur' && (gameState.currentCategory === 'passe' || gameState.currentCategory === 'attaque')) stat += 2;
                        if (ap.type === 'defenseur' && (gameState.currentCategory === 'defense' || gameState.currentCategory === 'rebond')) stat += 2;
                    }
                });
                total1 += stat;
                const card = renderCard(player, { size: 'small', isSixthMan: item === 'sixthman' });
                card.classList.add('battle-card');
                const so = document.createElement('div');
                so.textContent = stat;
                so.style.cssText = 'position:absolute;bottom:6px;left:50%;transform:translateX(-50%);font-size:26px;font-weight:bold;color:#f5576c;z-index:10;text-shadow:0 2px 6px rgba(0,0,0,0.8);';
                card.appendChild(so);
                card.style.transform = 'scale(0)'; card.style.transition = 'transform 0.5s';
                battle1Cards.appendChild(card);
                setTimeout(() => card.style.transform = 'scale(1)', 50);
            }, i * 600);
        });

        gameState.team2Selection.forEach((item, i) => {
            setTimeout(() => {
                const player = item === 'sixthman' ? sixthMan2 : deck2[item];
                let stat = player[gameState.currentCategory];
                gameState.activePowers.forEach(ap => {
                    if (ap.team === 2 && ap.playerIndex === item && ap.type === 'clutch') stat += 1;
                    if (ap.team === 2 && i === 1) {
                        if (ap.type === 'passeur' && (gameState.currentCategory === 'passe' || gameState.currentCategory === 'attaque')) stat += 2;
                        if (ap.type === 'defenseur' && (gameState.currentCategory === 'defense' || gameState.currentCategory === 'rebond')) stat += 2;
                    }
                });
                total2 += stat;
                const card = renderCard(player, { size: 'small', isSixthMan: item === 'sixthman' });
                card.classList.add('battle-card');
                const so = document.createElement('div');
                so.textContent = stat;
                so.style.cssText = 'position:absolute;bottom:6px;left:50%;transform:translateX(-50%);font-size:26px;font-weight:bold;color:#f5576c;z-index:10;text-shadow:0 2px 6px rgba(0,0,0,0.8);';
                card.appendChild(so);
                card.style.transform = 'scale(0)'; card.style.transition = 'transform 0.5s';
                battle2Cards.appendChild(card);
                setTimeout(() => card.style.transform = 'scale(1)', 50);
            }, i * 600);
        });

        setTimeout(() => {
            battle1Total.textContent = total1; battle2Total.textContent = total2;
            battle1Total.classList.add('show'); battle2Total.classList.add('show');
            setTimeout(() => {
                const diff = total1 - total2;
                let scoreQT1, scoreQT2;

                if (gameState.isGameWinnerPhase) {
                    if (diff > 0) { gameState.score1 += 3; scoreQT1 = 3; scoreQT2 = 0; winnerAnnouncement.textContent = `⚡ GAME WINNER JOUEUR 1! (+3 pts)`; winnerAnnouncement.classList.add('player1'); }
                    else if (diff < 0) { gameState.score2 += 3; scoreQT1 = 0; scoreQT2 = 3; winnerAnnouncement.textContent = `⚡ GAME WINNER JOUEUR 2! (+3 pts)`; winnerAnnouncement.classList.add('player2'); }
                    else { scoreQT1 = 0; scoreQT2 = 0; winnerAnnouncement.textContent = `🤝 ÉGALITÉ - Aucun point`; }
                } else {
                    const teamBalance = detectStrongerTeam();
                    if (diff === 0) {
                        if (teamBalance.hasStrongerTeam) { if (teamBalance.strongerTeam === 1) { scoreQT1 = randomInt(26,28); scoreQT2 = scoreQT1 + 1; } else { scoreQT2 = randomInt(26,28); scoreQT1 = scoreQT2 + 1; } }
                        else { const eq = randomInt(26,30); scoreQT1 = eq; scoreQT2 = eq; }
                    } else {
                        const baseQT = randomInt(48,58), absDiff = Math.abs(diff);
                        let pr = {};
                        if (!teamBalance.hasStrongerTeam) {
                            if (absDiff===1) pr={winner:[51,52],loser:[48,49]}; else if (absDiff===2) pr={winner:[52,54],loser:[46,48]}; else if (absDiff===3) pr={winner:[54,56],loser:[44,46]}; else if (absDiff===4) pr={winner:[56,58],loser:[42,44]}; else if (absDiff===5) pr={winner:[58,60],loser:[40,42]}; else pr={winner:[60,63],loser:[37,40]};
                        } else {
                            const strongerWins = (diff>0&&teamBalance.strongerTeam===1)||(diff<0&&teamBalance.strongerTeam===2);
                            if (strongerWins) { if (absDiff===1) pr={winner:[50.5,51],loser:[49,49.5]}; else if (absDiff===2) pr={winner:[51,52],loser:[48,49]}; else if (absDiff===3) pr={winner:[52,53],loser:[47,48]}; else if (absDiff===4) pr={winner:[53,54],loser:[46,47]}; else if (absDiff===5) pr={winner:[54,56],loser:[44,46]}; else pr={winner:[56,58],loser:[42,44]}; }
                            else { if (absDiff===1) pr={winner:[53,55],loser:[45,47]}; else if (absDiff===2) pr={winner:[55,57],loser:[43,45]}; else if (absDiff===3) pr={winner:[58,60],loser:[40,42]}; else if (absDiff===4) pr={winner:[60,62],loser:[38,40]}; else if (absDiff===5) pr={winner:[62,64],loser:[36,38]}; else pr={winner:[64,67],loser:[33,36]}; }
                        }
                        const wp = randomFloat(pr.winner[0],pr.winner[1])/100, lp = randomFloat(pr.loser[0],pr.loser[1])/100;
                        let t1, t2;
                        if (diff>0) { t1=baseQT*wp; t2=baseQT*lp; } else { t2=baseQT*wp; t1=baseQT*lp; }
                        scoreQT1 = Math.round(clamp(t1,15,40)); scoreQT2 = Math.round(clamp(t2,15,40));
                        if (scoreQT1===scoreQT2&&diff!==0) { if (diff>0) scoreQT1=Math.min(40,scoreQT1+1); else scoreQT2=Math.min(40,scoreQT2+1); }
                    }
                    gameState.score1 += scoreQT1; gameState.score2 += scoreQT2;
                    let displayText = '';
                    if (scoreQT1>scoreQT2) { displayText=`🏀 QT Joueur 1 (${scoreQT1} - ${scoreQT2})`; winnerAnnouncement.classList.add('player1'); }
                    else if (scoreQT2>scoreQT1) { displayText=`🏀 QT Joueur 2 (${scoreQT2} - ${scoreQT1})`; winnerAnnouncement.classList.add('player2'); }
                    else displayText=`🤝 QT Égalité (${scoreQT1} - ${scoreQT2})`;
                    if (teamBalance.hasStrongerTeam) displayText += ` ⚖️`;
                    winnerAnnouncement.textContent = displayText;
                }

                document.getElementById('score1').textContent = gameState.score1;
                document.getElementById('score2').textContent = gameState.score2;
                winnerAnnouncement.classList.add('show');

                setTimeout(() => {
                    if (gameState.round === 4 && !gameState.isGameWinnerPhase) {
                        if (Math.abs(gameState.score1 - gameState.score2) <= 3) startGameWinnerPhase(); else endGame();
                    } else if (gameState.isGameWinnerPhase) {
                        endGame();
                    } else {
                        nextRound();
                    }
                }, 3000);
            }, 1000);
        }, 1500);
    }, 500);
}

function nextRound() {
    const transition = document.getElementById('nextRoundTransition');
    gameState.round++;
    if (gameState.round === 4) gameState.categoryChooser = gameState.score1 < gameState.score2 ? 1 : 2;
    else if (gameState.round === 5) gameState.categoryChooser = gameState.categoryChooser === 1 ? 2 : 1;
    transition.textContent = `Manche ${gameState.round}`;
    transition.classList.add('show');
    setTimeout(() => {
        document.getElementById('battleAnimation').classList.remove('show');
        setTimeout(() => {
            transition.classList.remove('show');
            gameState.team1Selection = []; gameState.team2Selection = [];
            gameState.usedIndicesDeck1 = []; gameState.usedIndicesDeck2 = [];
            gameState.currentCategory = null; gameState.activePowers = [];
            gameState.bannedPlayers1 = []; gameState.bannedPlayers2 = [];
            if (gameState.round === 3) {
                const categories = ['defense', 'rebond', 'attaque', 'passe'];
                gameState.currentCategory = categories[Math.floor(Math.random() * categories.length)];
            }
            showPlayerSelection(getFirstPlayer());
        }, 500);
    }, 2000);
}

function startGameWinnerPhase() {
    const transition = document.getElementById('nextRoundTransition');
    transition.innerHTML = `⚡ GAME WINNER!<br><span style="font-size: 36px;">3 points en jeu</span>`;
    transition.classList.add('show');
    setTimeout(() => {
        document.getElementById('battleAnimation').classList.remove('show');
        setTimeout(() => {
            transition.classList.remove('show');
            gameState.team1Selection = []; gameState.team2Selection = [];
            gameState.usedIndicesDeck1 = []; gameState.usedIndicesDeck2 = [];
            gameState.currentCategory = null; gameState.activePowers = [];
            gameState.bannedPlayers1 = []; gameState.bannedPlayers2 = [];
            gameState.isGameWinnerPhase = true;
            if (gameState.score1 === gameState.score2) {
                const categories = ['defense', 'rebond', 'attaque', 'passe'];
                gameState.currentCategory = categories[Math.floor(Math.random() * categories.length)];
                showPlayerSelection(1);
            } else {
                showPlayerSelection(gameState.score1 > gameState.score2 ? 1 : 2);
            }
        }, 500);
    }, 2500);
}

function endGameWinner() { endGame(); }

function endGame() {
    const transition = document.getElementById('nextRoundTransition');
    transition.innerHTML = gameState.score1 > gameState.score2
        ? `🏆 VICTOIRE JOUEUR 1!<br><span style="font-size: 48px;">${gameState.score1} - ${gameState.score2}</span>`
        : `🏆 VICTOIRE JOUEUR 2!<br><span style="font-size: 48px;">${gameState.score2} - ${gameState.score1}</span>`;
    transition.classList.add('show');
    setTimeout(() => {
        document.getElementById('battleAnimation').classList.remove('show');
        setTimeout(() => {
            transition.classList.remove('show');
            document.getElementById('selectionSection').classList.add('hidden');
            document.getElementById('gameOverSection').classList.remove('hidden');
            const message = document.getElementById('gameOverMessage');
            if (gameState.score1 > gameState.score2) message.innerHTML = `🏆 VICTOIRE JOUEUR 1!<br>${gameState.score1} - ${gameState.score2}`;
            else message.innerHTML = `🏆 VICTOIRE JOUEUR 2!<br>${gameState.score2} - ${gameState.score1}`;
        }, 500);
    }, 3000);
}

// ═══════════════════════════════════════════════
// PACK SYSTEM
// ═══════════════════════════════════════════════

// Calcule le score d'une carte (somme stats) — plus c'est élevé, plus c'est rare
function cardScore(card) {
    return (card.attaque || 0) + (card.rebond || 0) + (card.passe || 0) + (card.defense || 0);
}

// Tirage pondéré : les cartes avec un score élevé ont moins de chances d'être tirées
function weightedDraw(pool, count) {
    const drawn = [];
    const remaining = [...pool];

    for (let i = 0; i < count && remaining.length > 0; i++) {
        // Poids inversé : score faible = poids élevé
        const maxScore = Math.max(...remaining.map(c => cardScore(c)));
        const weights = remaining.map(c => (maxScore - cardScore(c) + 1));
        const totalWeight = weights.reduce((a, b) => a + b, 0);

        let rand = Math.random() * totalWeight;
        let chosenIdx = 0;
        for (let j = 0; j < weights.length; j++) {
            rand -= weights[j];
            if (rand <= 0) { chosenIdx = j; break; }
        }

        drawn.push(remaining[chosenIdx]);
        remaining.splice(chosenIdx, 1);
    }
    return drawn;
}

document.getElementById('packsBtn').addEventListener('click', () => {
    document.getElementById('packChoiceOverlay').classList.add('show');
});

document.querySelectorAll('.pack-option-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const packType = btn.dataset.packType;
        customConfirm('Ouvrir un pack', `Ouvrir le ${packType === 'basic' ? 'Pack Basique' : 'Pack Premium'} ?`).then(confirmed => {
            if (confirmed) { document.getElementById('packChoiceOverlay').classList.remove('show'); openPack(packType); }
        });
    });
});

async function openPack(packType) {
    if (!allCards.length) { await customAlert('Erreur', 'Les cartes ne sont pas chargées.'); return; }

    // ── 1. TIRAGE DES 3 CARTES ──────────────────────────────
    const drawnCards = weightedDraw(allCards, 3);
    // La meilleure (score le plus élevé) = celle révélée dans l'animation
    drawnCards.sort((a, b) => cardScore(b) - cardScore(a));
    const bestCard   = drawnCards[0];
    const otherCards = [drawnCards[1], drawnCards[2]];

    // ── 2. ANIMATION VIDÉO ──────────────────────────────────
    const overlay      = document.getElementById('packOpeningOverlay');
    const video        = document.getElementById('packVideo');
    const revealPos    = document.getElementById('revealPosition');
    const revealLogo   = document.getElementById('revealLogo');

    // Reset
    revealPos.classList.remove('visible');
    revealLogo.classList.remove('visible');
    const revealCardContainer = document.getElementById('revealCardContainer');
    if (revealCardContainer) {
        revealCardContainer.classList.remove('visible');
        revealCardContainer.innerHTML = '';
    }
    revealPos.textContent = '';
    revealLogo.src = '';

    overlay.classList.add('show');
    video.currentTime = 0;
    video.play().catch(e => console.error("Erreur vidéo :", e));

    // Poste du joueur
    setTimeout(() => {
        revealPos.textContent = bestCard.Position || '';
        revealPos.classList.add('visible');
    }, 4000);
    setTimeout(() => revealPos.classList.remove('visible'), 7000);

    // Logo du club (depuis image_url du logo si dispo, sinon on cache)
    setTimeout(() => {
        if (bestCard['logo.url']) {
            revealLogo.src = bestCard['logo.url'];
            revealLogo.classList.add('visible');
        }
    }, 8000);

    // Carte complète rendue avec renderCard
    setTimeout(() => {
        const revealCardContainer = document.getElementById('revealCardContainer');
        if (revealCardContainer) {
            revealCardContainer.innerHTML = '';
            const cardEl = renderCard(bestCard, { size: 'normal' });
            cardEl.style.cursor = 'default';
            revealCardContainer.appendChild(cardEl);
            revealCardContainer.classList.add('visible');
        }
    }, 12000);

    // ── 3. AFFICHAGE FIFA APRÈS LA VIDÉO ────────────────────
    const showPackResult = () => {
        overlay.classList.remove('show');
        showPackReveal(bestCard, otherCards, drawnCards);
    };

    video.onended = () => setTimeout(showPackResult, 1500);
    // Sécurité si la vidéo ne se termine pas
    setTimeout(() => { if (overlay.classList.contains('show')) showPackResult(); }, 28000);
}

// ── ÉCRAN FIFA : révélation des 3 cartes ────────────────────
function showPackReveal(bestCard, otherCards, drawnCards) {
    // Crée l'overlay de révélation s'il n'existe pas
    let revealOverlay = document.getElementById('packRevealOverlay');
    if (!revealOverlay) {
        revealOverlay = document.createElement('div');
        revealOverlay.id = 'packRevealOverlay';
        revealOverlay.style.cssText = `
            position:fixed; inset:0; z-index:7000;
            background:#0a0a0a;
            display:flex; flex-direction:column;
            justify-content:center; align-items:center; gap:32px;
        `;
        document.body.appendChild(revealOverlay);
    }

    const rarityColors = { bronze: '#cd7f32', argent: '#aaa9ad', or: '#ffd700' };

    function buildCardEl(card, revealed) {
        if (!revealed) {
            const hidden = document.createElement('div');
            hidden.className = 'pack-card pack-card-hidden';
            hidden.dataset.cardId = card.id;
            hidden.style.cssText = 'width:160px;height:237px;border-radius:12px;cursor:pointer;background:linear-gradient(135deg,#1a1a2e,#16213e);border:2px solid rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;font-size:48px;transition:transform 0.3s;box-shadow:0 8px 32px rgba(0,0,0,0.6);';
            hidden.textContent = '🏀';
            hidden.onclick = () => revealPackCard(hidden, card.id);
            return hidden;
        }
        const el = renderCard(card, { size: 'normal' });
        el.style.animation = 'cardFlip 0.5s ease-out';
        el.style.background = 'transparent';
        el.classList.add('pack-card', 'pack-card-revealed');
        return el;
    }
    // Alias pour compatibilité inline HTML existant
    function buildCardHTML(card, revealed) { return ''; }

    revealOverlay.innerHTML = `
        <style>
            @keyframes cardFlip {
                from { transform: rotateY(90deg) scale(0.8); opacity:0; }
                to   { transform: rotateY(0deg) scale(1); opacity:1; }
            }
            .pack-card-hidden:hover { transform: translateY(-8px) scale(1.05) !important; }
        </style>

        <div style="font-family:'Bebas Neue',sans-serif; font-size:22px; letter-spacing:5px; color:#6b6560; text-transform:uppercase;">
            Tes cartes
        </div>

        <div id="packCardsRow" style="display:flex; gap:24px; align-items:flex-end; flex-wrap:wrap; justify-content:center;"></div>

        <button id="savePackBtn" onclick="savePackCards()" style="
            padding:12px 40px;
            font-family:'Bebas Neue',sans-serif;
            font-size:16px; letter-spacing:3px; text-transform:uppercase;
            background:#4CAF50; color:#fff;
            border:none; border-radius:4px; cursor:pointer;
            margin-top:8px;
            box-shadow: 0 4px 20px rgba(76,175,80,0.4);
        ">✅ Enregistrer dans ma collection</button>
    `;

    // Stocker les données pour révélation et sauvegarde
    revealOverlay._otherCards  = otherCards;
    revealOverlay._drawnCards  = drawnCards || [bestCard, ...otherCards];

    // Remplir la rangée de cartes avec renderCard
    const row = document.getElementById('packCardsRow');
    // Meilleure carte
    const bestWrap = document.createElement('div');
    bestWrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:8px;';
    const bestLabel = document.createElement('div');
    bestLabel.style.cssText = 'font-size:10px;letter-spacing:2px;color:#e8832a;font-weight:600;text-transform:uppercase;';
    bestLabel.textContent = 'Meilleure carte';
    bestWrap.appendChild(bestLabel);
    bestWrap.appendChild(buildCardEl(bestCard, true));
    row.appendChild(bestWrap);
    // 2 autres cartes cachées
    otherCards.forEach(oc => {
        const w = document.createElement('div');
        w.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:8px;';
        const lbl = document.createElement('div');
        lbl.style.cssText = 'font-size:10px;letter-spacing:2px;color:#6b6560;font-weight:600;text-transform:uppercase;';
        lbl.textContent = 'Clique pour révéler';
        w.appendChild(lbl);
        w.appendChild(buildCardEl(oc, false));
        row.appendChild(w);
    });
}

window.revealPackCard = function(el, cardId) {
    const overlay = document.getElementById('packRevealOverlay');
    const card = allCards.find(c => c.id == cardId) || overlay._otherCards?.find(c => c.id == cardId);
    if (!card) return;

    const rarityColors = { bronze: '#cd7f32', argent: '#aaa9ad', or: '#ffd700' };
    const score = cardScore(card);
    const color = rarityColors[card.rarity] || '#888';

    const parent = el.parentElement;
    parent.querySelector('.pack-card-hidden')?.remove();

    const revealedCard = renderCard(card, { size: 'normal' });
    revealedCard.classList.add('pack-card', 'pack-card-revealed');
    revealedCard.style.animation = 'cardFlip 0.5s ease-out';
    parent.appendChild(revealedCard);
};

window.savePackCards = async function() {
    const overlay = document.getElementById('packRevealOverlay');
    const drawn = overlay?._drawnCards;
    if (!drawn || !drawn.length) {
        overlay?.remove();
        return;
    }

    const btn = document.getElementById('savePackBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Enregistrement...'; }

    try {
        // IDs en bigint pour la fonction RPC
        const cardIds = drawn.map(c => parseInt(c.id)).filter(n => !isNaN(n));
        console.log('Saving card IDs:', cardIds);

        const { error } = await window.mySupabase
            .rpc('append_cards_to_collection', { card_ids_to_add: cardIds });

        if (error) throw error;

        console.log('✅ Cartes enregistrées via RPC !');
        await loadAllCardsAndCollection();
        overlay?.remove();

        // Si le vestiaire est ouvert, re-rendre l'effectif
        const lockerPage = document.getElementById('lockerPage');
        if (lockerPage && lockerPage.classList.contains('show')) {
            renderEffectif();
        }

        // Message de succès
        await customAlert('🎉 Cartes ajoutées !', `${cardIds.length} carte(s) ajoutée(s) à ta collection. Va dans le Vestiaire → Effectif → "+ Ajouter" pour les mettre dans ton équipe.`);

    } catch (err) {
        console.error('Erreur enregistrement pack:', err);
        const btnEl = document.getElementById('savePackBtn');
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.textContent = '❌ Erreur — Réessayer';
            btnEl.style.background = '#e53935';
        }
    }
};

window.closePackReveal = function() {
    const overlay = document.getElementById('packRevealOverlay');
    if (overlay) overlay.remove();
};

// ═══════════════════════════════════════════════
// VESTIAIRE
// ═══════════════════════════════════════════════
function getPowerColor(power) { const colors = {'Rim Runner':'#e8832a','Vision':'#2980b9','Handle':'#8e44ad','Guerrier':'#c0392b','Block':'#27ae60','3pts':'#f1c40f','Lockdown':'#16a085','Steal':'#d35400','Mid-Range':'#7f8c8d','Clutch':'#e74c3c','Catch&shoot':'#2ecc71','Versatile':'#3498db','Dunk':'#e91e63','Microwave':'#ff9800'}; return colors[power] || '#888'; }
function getPowerLabel(power) { return power || ''; }

function renderEffectif() {
    const slotsContainer = document.getElementById('effectifSlots');
    const smContainer    = document.getElementById('sixthManSlot');
    const ownedList      = document.getElementById('ownedCardsList');
    const countEl        = document.getElementById('collectionCount');
    slotsContainer.innerHTML = '';
    smContainer.innerHTML    = '';
    if (ownedList) ownedList.innerHTML = '';

    // ── 5 Majeurs ──────────────────────────────────────────
    const starterSlots = roster.starters.length >= 5
        ? roster.starters
        : [...roster.starters, ...Array(5 - roster.starters.length).fill(null)];

    starterSlots.forEach((playerId, slotIdx) => {
        const player = playerId ? allCards.find(c => String(c.id) === String(playerId)) : null;
        const slot = document.createElement('div');
        slot.className = 'effectif-slot ' + (player ? 'filled' : 'empty-slot');

        const label = document.createElement('span');
        label.className = 'slot-label';
        label.textContent = `Starter ${slotIdx + 1}`;
        slot.appendChild(label);

        if (player) {
            const cardEl = renderCard(player, { size: 'small' });
            cardEl.style.cursor = 'default';
            slot.appendChild(cardEl);
            const btn = document.createElement('button');
            btn.className = 'slot-change-btn';
            btn.dataset.slot = 'starter';
            btn.dataset.slotIndex = slotIdx;
            btn.textContent = '🔄 Changer';
            slot.appendChild(btn);
        } else {
            const empty = document.createElement('div');
            empty.className = 'slot-placeholder';
            empty.textContent = '+ Ajouter';
            slot.appendChild(empty);
        }
        slotsContainer.appendChild(slot);
    });

    // ── 6e Homme ───────────────────────────────────────────
    const smPlayer = roster.sixthMan
        ? allCards.find(c => String(c.id) === String(roster.sixthMan))
        : null;

    const smSlot = document.createElement('div');
    smSlot.className = 'effectif-slot ' + (smPlayer ? 'filled' : 'empty-slot');
    const smLabel = document.createElement('span');
    smLabel.className = 'slot-label';
    smLabel.textContent = '6e Homme';
    smSlot.appendChild(smLabel);

    if (smPlayer) {
        const smCardEl = renderCard(smPlayer, { size: 'small', isSixthMan: true });
        smCardEl.style.cursor = 'default';
        smSlot.appendChild(smCardEl);
        const smBtn = document.createElement('button');
        smBtn.className = 'slot-change-btn';
        smBtn.dataset.slot = 'sixthman';
        smBtn.dataset.slotIndex = '0';
        smBtn.textContent = '🔄 Changer';
        smSlot.appendChild(smBtn);
    } else {
        const smEmpty = document.createElement('div');
        smEmpty.className = 'slot-placeholder';
        smEmpty.textContent = '+ Ajouter';
        smSlot.appendChild(smEmpty);
    }
    smContainer.appendChild(smSlot);

    // Bind boutons "Changer"
    document.querySelectorAll('.slot-change-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            openSwapModal(this.dataset.slot, parseInt(this.dataset.slotIndex));
        });
    });

    // ── Ma Collection (liste scrollable) ──────────────────
    if (!ownedList) return;

    if (ownedCards.length === 0) {
        ownedList.innerHTML = '<div style="text-align:center; color:rgba(255,255,255,0.3); padding:30px; font-size:14px;">Aucune carte — ouvre des packs !</div>';
        if (countEl) countEl.textContent = '(0 carte)';
        return;
    }

    if (countEl) countEl.textContent = `(${ownedCards.length} carte${ownedCards.length > 1 ? 's' : ''})`;

    // Grouper par équipe
    const byTeam = {};
    ownedCards.forEach(id => {
        const p = allCards.find(c => String(c.id) === String(id));
        if (!p) return;
        const team = p.team || 'Autres';
        if (!byTeam[team]) byTeam[team] = [];
        byTeam[team].push(p);
    });

    Object.keys(byTeam).sort().forEach(team => {
        // En-tête équipe
        const teamHeader = document.createElement('div');
        teamHeader.className = 'owned-team-header';
        teamHeader.textContent = team;
        ownedList.appendChild(teamHeader);

        // Grille cartes
        const row = document.createElement('div');
        row.className = 'owned-cards-row';
        ownedList.appendChild(row);

        byTeam[team].forEach(player => {
            const wrap = document.createElement('div');
            wrap.className = 'owned-card-wrap';

            const cardEl = renderCard(player, { size: 'small' });
            cardEl.style.cursor = 'default';
            wrap.appendChild(cardEl);

            // Boutons d'assignation
            const btns = document.createElement('div');
            btns.className = 'owned-card-btns';

            // Starter : dropdown
            const sel = document.createElement('select');
            sel.className = 'assign-select';
            sel.innerHTML = '<option value="">+ Starter</option>';
            for (let i = 0; i < 5; i++) {
                const opt = document.createElement('option');
                opt.value = i;
                const currentId = roster.starters[i];
                const isThis = currentId && String(currentId) === String(player.id);
                opt.textContent = isThis ? `✓ Starter ${i+1}` : `Starter ${i+1}`;
                if (isThis) opt.selected = true;
                sel.appendChild(opt);
            }
            sel.addEventListener('change', async function() {
                const slotIdx = parseInt(this.value);
                if (isNaN(slotIdx)) return;
                roster.starters[slotIdx] = player.id;
                await saveRoster();
                renderEffectif();
            });
            btns.appendChild(sel);

            // 6e Homme
            const smBtnEl = document.createElement('button');
            smBtnEl.className = 'assign-btn-sm';
            const isThisSM = roster.sixthMan && String(roster.sixthMan) === String(player.id);
            smBtnEl.textContent = isThisSM ? '★ 6e H.' : '6e H.';
            smBtnEl.style.background = isThisSM ? '#ffd700' : 'rgba(255,215,0,0.15)';
            smBtnEl.style.color = isThisSM ? '#000' : '#ffd700';
            smBtnEl.addEventListener('click', async () => {
                roster.sixthMan = player.id;
                await saveRoster();
                renderEffectif();
            });
            btns.appendChild(smBtnEl);

            wrap.appendChild(btns);
            row.appendChild(wrap);
        });
    });
}

async function saveRoster() {
    try {
        const { error } = await window.mySupabase
            .from('player_collections')
            .update({ roster })
            .eq('user_id', currentUser.id);
        if (error) console.error('Erreur sauvegarde roster:', error);
    } catch(e) { console.error(e); }
}


let swapTarget = null;
function openSwapModal(slotType, slotIndex) {
    swapTarget = { slot: slotType, index: slotIndex };
    document.getElementById('swapModalTitle').textContent = slotType === 'starter' ? `Choisir un remplaçant pour Starter ${slotIndex + 1}` : 'Choisir un nouveau 6e Homme';
    const grid = document.getElementById('swapCardsGrid');
    grid.innerHTML = '';
    ownedCards.forEach(playerId => {
        // Comparaison tolérante : bigint vs string
        const player = allCards.find(c => String(c.id) === String(playerId));
        if (!player) return;
        const isInRoster = roster.starters.map(String).includes(String(playerId)) || String(roster.sixthMan) === String(playerId);
        const card = renderCard(player, { size: 'small' });
        card.classList.toggle('in-roster', isInRoster);
        card.style.opacity = isInRoster ? '0.5' : '1';
        card.style.cursor  = isInRoster ? 'not-allowed' : 'pointer';
        if (isInRoster) {
            const badge = document.createElement('div');
            badge.textContent = '★ Effectif';
            badge.style.cssText = 'position:absolute;top:4px;left:50%;transform:translateX(-50%);background:#ffd700;color:#000;font-size:9px;font-weight:bold;padding:1px 6px;border-radius:3px;z-index:10;white-space:nowrap;';
            card.appendChild(badge);
        }
        if (!isInRoster) card.addEventListener('click', () => swapPlayer(playerId));
        grid.appendChild(card);
    });
    document.getElementById('swapModal').classList.add('show');
}

async function swapPlayer(newPlayerIdx) {
    if (!swapTarget) return;
    if (swapTarget.slot === 'starter') roster.starters[swapTarget.index] = newPlayerIdx;
    else roster.sixthMan = newPlayerIdx;
    document.getElementById('swapModal').classList.remove('show');
    swapTarget = null;
    await saveRoster();
    renderEffectif();
}

// ═══════════════════════════════════════════════
// CLASSEUR / BINDER
// ═══════════════════════════════════════════════
let binderPages = [], binderCurrentPage = 0, binderIsAnimating = false;

function buildBinderPages() {
    binderPages = [];
    const CARDS_PER_PAGE = 4;

    // Récupérer toutes les équipes depuis allCards (pas juste ownedCards)
    const teams = [...new Set(allCards.map(c => c.team).filter(Boolean))].sort();
    const ownedStrings = ownedCards.map(String);

    teams.forEach(team => {
        const teamCards = allCards.filter(c => c.team === team);
        const owned = teamCards.filter(c => ownedStrings.includes(String(c.id)));
        const missing = teamCards.filter(c => !ownedStrings.includes(String(c.id)));
        // Toutes les cartes de l'équipe (possédées d'abord, puis manquantes)
        const allTeamCards = [...owned, ...missing];

        // Découper en pages de 4
        for (let i = 0; i < allTeamCards.length; i += CARDS_PER_PAGE) {
            binderPages.push({
                title: team,
                subtitle: `${owned.length}/${teamCards.length}`,
                cards: allTeamCards.slice(i, i + CARDS_PER_PAGE),
                ownedStrings
            });
        }
    });
}


function renderPageContent(pageIndex) {
    if (pageIndex < 0 || pageIndex >= binderPages.length) {
        return '<div class="page-content" style="background:transparent;"></div>';
    }
    const page = binderPages[pageIndex];
    if (page.isSeparator) {
        return '<div class="page-content" style="display:flex;align-items:center;justify-content:center;"><div style="color:#1e3c72;font-size:12px;opacity:0.4;font-style:italic;">—</div></div>';
    }

    const ownedS = page.ownedStrings || [];
    let cardsHTML = '';

    page.cards.forEach(player => {
        const isOwned = ownedS.includes(String(player.id));
        const isInRoster = (roster.starters || []).map(String).includes(String(player.id))
            || String(roster.sixthMan) === String(player.id);

        if (isOwned) {
            // Carte possédée — affichage normal style binder
            cardsHTML += `
            <div class="binder-card">
                ${isInRoster ? '<div class="col-in-roster">★</div>' : ''}
                <img src="${player.image_url || ''}" alt="${player.name}"
                     style="width:100%;height:70px;object-fit:cover;object-position:top center;border-radius:4px;margin-bottom:4px;"
                     onerror="this.style.display='none'">
                <div class="col-name">${player.name}</div>
                <div class="col-stats" style="font-size:8px;color:#555;line-height:1.5;">
                    <span style="color:#e63329">●${player.attaque}</span>
                    <span style="color:#00b8d9">●${player.defense}</span>
                    <span style="color:#6abf45">●${player.passe}</span>
                    <span style="color:#f0b429">●${player.rebond}</span>
                </div>
            </div>`;
        } else {
            // Carte manquante — silhouette
            cardsHTML += `
            <div class="binder-card binder-card-missing">
                <div style="width:100%;height:70px;background:#e8e4dc;border-radius:4px;margin-bottom:4px;display:flex;align-items:center;justify-content:center;font-size:24px;color:rgba(30,60,114,0.15);">?</div>
                <div class="col-name" style="color:rgba(30,60,114,0.3);">${player.name}</div>
                <div style="font-size:8px;color:rgba(30,60,114,0.2);">Non possédée</div>
            </div>`;
        }
    });

    // Compteur possédées/total
    const owned = page.cards.filter(p => ownedS.includes(String(p.id))).length;
    const total = page.cards.length;

    return `<div class="page-content">
        <div class="page-title">
            ${page.title}
            <span style="font-size:9px;color:rgba(30,60,114,0.5);margin-left:6px;">${page.subtitle || ''}</span>
        </div>
        <div class="page-cards-grid">${cardsHTML}</div>
    </div>`;
}


function renderBinder() {
    const leftIdx = binderCurrentPage * 2 - 1, rightIdx = binderCurrentPage * 2;
    document.getElementById('pageLeft').innerHTML = renderPageContent(leftIdx);
    document.getElementById('pageRight').innerHTML = renderPageContent(rightIdx);
    if (leftIdx >= 0 && leftIdx < binderPages.length) document.getElementById('pageLeft').innerHTML += `<div class="page-number left">${leftIdx + 1}</div>`;
    if (rightIdx >= 0 && rightIdx < binderPages.length) document.getElementById('pageRight').innerHTML += `<div class="page-number right">${rightIdx + 1}</div>`;
    const totalSpreads = Math.ceil(binderPages.length / 2);
    document.getElementById('binderPrev').disabled = binderCurrentPage <= 0;
    document.getElementById('binderNext').disabled = binderCurrentPage >= totalSpreads - 1;
    document.getElementById('binderIndicator').textContent = `Spread ${binderCurrentPage + 1} / ${totalSpreads}`;
}

function flipPageForward() {
    if (binderIsAnimating) return;
    const totalSpreads = Math.ceil(binderPages.length / 2);
    if (binderCurrentPage >= totalSpreads - 1) return;
    binderIsAnimating = true;
    const turning = document.getElementById('pageTurning'), turningFront = document.getElementById('turningFront'), turningBack = document.getElementById('turningBack');
    turning.className = 'page-turning from-right';
    turningFront.innerHTML = renderPageContent(binderCurrentPage * 2);
    turningBack.innerHTML = renderPageContent(binderCurrentPage * 2 + 1);
    turningBack.style.transform = 'rotateY(180deg) scaleX(-1)';
    void turning.offsetWidth;
    turning.classList.add('flip-left');
    turning.addEventListener('transitionend', function handler() {
        turning.removeEventListener('transitionend', handler);
        binderCurrentPage++;
        renderBinder();
        turning.className = 'page-turning from-right'; turning.style.transition = 'none'; void turning.offsetWidth; turning.style.transition = '';
        binderIsAnimating = false;
    });
}

function flipPageBackward() {
    if (binderIsAnimating) return;
    if (binderCurrentPage <= 0) return;
    binderIsAnimating = true;
    const turning = document.getElementById('pageTurning'), turningFront = document.getElementById('turningFront'), turningBack = document.getElementById('turningBack');
    turning.className = 'page-turning from-left';
    turning.style.transform = 'rotateY(180deg)';
    turningFront.innerHTML = renderPageContent(binderCurrentPage * 2 - 1);
    turningBack.innerHTML = renderPageContent(binderCurrentPage * 2 - 2);
    turningBack.style.transform = 'rotateY(180deg) scaleX(-1)';
    void turning.offsetWidth;
    turning.style.transform = 'rotateY(0deg)';
    turning.addEventListener('transitionend', function handler() {
        turning.removeEventListener('transitionend', handler);
        binderCurrentPage--;
        renderBinder();
        turning.className = 'page-turning from-right'; turning.style.transition = 'none'; turning.style.transform = ''; void turning.offsetWidth; turning.style.transition = '';
        binderIsAnimating = false;
    });
}

function renderCollection() {
    // Classeur : toutes les cartes du jeu classées par équipe
    // Possédées = couleur normale, manquantes = grisées avec silhouette
    buildBinderPages();
    binderCurrentPage = 0;
    renderBinder();
}

// buildBinderPages réécrit : toutes les cartes du jeu, groupées par équipe
// Possédées et manquantes

// ═══════════════════════════════════════════════
// EVENT LISTENERS VESTIAIRE
// ═══════════════════════════════════════════════
document.getElementById('lockerBtn').addEventListener('click', function() { document.getElementById('mainMenu').style.display = 'none'; document.getElementById('lockerPage').classList.add('show'); renderEffectif(); });
document.getElementById('lockerBackBtn').addEventListener('click', function() { document.getElementById('lockerPage').classList.remove('show'); document.getElementById('mainMenu').style.display = 'flex'; });
document.getElementById('tabEffectif').addEventListener('click', function() { this.classList.add('active'); document.getElementById('tabCollection').classList.remove('active'); document.getElementById('effectifContainer').classList.add('show'); document.getElementById('collectionContainer').classList.remove('show'); renderEffectif(); });
document.getElementById('tabCollection').addEventListener('click', function() { this.classList.add('active'); document.getElementById('tabEffectif').classList.remove('active'); document.getElementById('collectionContainer').classList.add('show'); document.getElementById('effectifContainer').classList.remove('show'); renderCollection(); });
document.getElementById('binderPrev').addEventListener('click', flipPageBackward);
document.getElementById('binderNext').addEventListener('click', flipPageForward);
document.getElementById('swapModalClose').addEventListener('click', function() { document.getElementById('swapModal').classList.remove('show'); swapTarget = null; });

// ═══════════════════════════════════════════════
// AUTH & LOBBY
// ═══════════════════════════════════════════════
async function checkAuth() {
    if (!window.mySupabase) { showAuth(); return; }
    try {
        const { data, error } = await window.mySupabase.auth.getSession();
        if (error || !data.session) { showAuth(); return; }
        currentUser = data.session.user;
        await loadProfile();
        await loadAllCardsAndCollection();
        showMainMenu();
    } catch(e) {
        console.error("Erreur auth:", e);
        showAuth();
    }
}

async function loadProfile() {
    const result = await window.mySupabase.from('profiles').select('username').eq('id', currentUser.id).single();
    if (result.data) document.getElementById('lobbyUser').textContent = result.data.username;
}

async function handleLogin(email, password) {
    const result = await window.mySupabase.auth.signInWithPassword({ email, password });
    if (result.error) { document.getElementById('loginError').textContent = result.error.message; document.getElementById('loginError').classList.add('show'); return false; }
    currentUser = result.data.user;
    await loadProfile();
    await loadAllCardsAndCollection();
    showMainMenu();
    return true;
}

async function handleSignup(email, password, username) {
    const result = await window.mySupabase.auth.signUp({ email, password });
    if (result.error) { document.getElementById('signupError').textContent = result.error.message; document.getElementById('signupError').classList.add('show'); return false; }
    if (result.data.user) await window.mySupabase.from('profiles').update({ username }).eq('id', result.data.user.id);
    await customAlert('Compte créé', 'Vous pouvez maintenant vous connecter');
    showLoginForm();
    return true;
}

async function handleLogout() { await window.mySupabase.auth.signOut(); currentUser = null; currentGameId = null; showAuth(); }
function showAuth() { document.getElementById('authScreen').classList.add('show'); document.getElementById('lobbyScreen').classList.remove('show'); document.getElementById('mainMenu').style.display = 'none'; }
function showMainMenu() { document.getElementById('authScreen').classList.remove('show'); document.getElementById('lobbyScreen').classList.remove('show'); document.getElementById('mainMenu').style.display = 'flex'; }
function showLoginForm() { document.getElementById('loginForm').style.display = 'block'; document.getElementById('signupForm').style.display = 'none'; document.getElementById('loginError').classList.remove('show'); }
function showSignupForm() { document.getElementById('loginForm').style.display = 'none'; document.getElementById('signupForm').style.display = 'block'; document.getElementById('signupError').classList.remove('show'); }

async function loadGames() {
    const { data, error } = await window.mySupabase.from('games').select(`id, player1_id, player1:profiles!games_player1_id_fkey(username)`).eq('status', 'waiting').order('created_at', { ascending: false });
    if (error) { console.error("Erreur loadGames :", error); document.getElementById('gamesList').innerHTML = '<div style="color:red;">Erreur chargement parties</div>'; return; }
    const list = document.getElementById('gamesList');
    if (!data || data.length === 0) { list.innerHTML = '<div style="text-align:center;color:#999;">Aucune partie</div>'; return; }
    list.innerHTML = '';
    data.forEach(game => {
        const username = game.player1?.username || 'Joueur inconnu';
        const div = document.createElement('div');
        div.className = 'game-item';
        div.innerHTML = `<div><b style="color:#ffd700;">${username}</b><br><small>En attente...</small></div><button class="join-btn" onclick="joinGame('${game.id}')">Rejoindre</button>`;
        list.appendChild(div);
    });
}

window.joinGame = async function(gameId) {
    const { data: collection, error: collectionError } = await window.mySupabase.from('player_collections').select('roster, owned_cards').eq('user_id', currentUser.id).single();
    if (collectionError) { console.error("Erreur chargement collection :", collectionError); alert("Impossible de charger ta collection. Réessaie."); return; }
    if (collection) { roster = collection.roster || { starters: [], sixthMan: null }; ownedCards = collection.owned_cards || []; }
    const { error: updateError } = await window.mySupabase.from('games').update({ player2_id: currentUser.id, status: 'in_progress' }).eq('id', gameId);
    if (updateError) { console.error("Erreur mise à jour partie :", updateError); alert("Impossible de rejoindre la partie. Réessaie."); return; }
    currentGameId = gameId; isOnlineMode = true;
    document.getElementById('lobbyScreen').classList.remove('show');
    startGame();
};

async function createGame() {
    if (!currentUser) { alert("Tu dois être connecté pour créer une partie !"); return; }
    await window.mySupabase.from('games').delete().eq('player1_id', currentUser.id).eq('status', 'waiting');
    const { data: collection, error: collError } = await window.mySupabase.from('player_collections').select('roster, owned_cards').eq('user_id', currentUser.id).single();
    if (collError) { console.error("Erreur chargement collection :", collError); alert("Impossible de charger ta collection."); return; }
    roster = collection?.roster || { starters: [], sixthMan: null };
    ownedCards = collection?.owned_cards || [];
    const { data: newGame, error: insertError } = await window.mySupabase.from('games').insert({ player1_id: currentUser.id, status: 'waiting' }).select().single();
    if (insertError) { console.error("Erreur création partie :", insertError); alert("Impossible de créer la partie."); return; }
    currentGameId = newGame.id;
    document.getElementById('lobbyContent').style.display = 'none';
    document.getElementById('waitingRoom').style.display = 'block';
    document.getElementById('createGameBtn').disabled = true;
    initRealtime(currentGameId);
    loadGames();
}

async function cancelWaiting() {
    if (currentGameId) await window.mySupabase.from('games').delete().eq('id', currentGameId);
    document.getElementById('lobbyContent').style.display = 'block';
    document.getElementById('waitingRoom').style.display = 'none';
    currentGameId = null;
    loadGames();
}

// EVENT LISTENERS AUTH
document.getElementById('loginBtn').addEventListener('click', async () => {
    const email = document.getElementById('loginEmail').value, password = document.getElementById('loginPassword').value;
    if (email && password) { document.getElementById('loginBtn').disabled = true; await handleLogin(email, password); document.getElementById('loginBtn').disabled = false; }
});
document.getElementById('signupBtn').addEventListener('click', async () => {
    const email = document.getElementById('signupEmail').value, password = document.getElementById('signupPassword').value, username = document.getElementById('signupUsername').value;
    if (email && password && username) {
        if (password.length < 6) { document.getElementById('signupError').textContent = 'Mot de passe trop court'; document.getElementById('signupError').classList.add('show'); return; }
        document.getElementById('signupBtn').disabled = true; await handleSignup(email, password, username); document.getElementById('signupBtn').disabled = false;
    }
});
document.getElementById('showSignup').addEventListener('click', showSignupForm);
document.getElementById('showLogin').addEventListener('click', showLoginForm);
document.getElementById('logoutBtn').addEventListener('click', handleLogout);
document.getElementById('createGameBtn').addEventListener('click', createGame);
document.getElementById('refreshBtn').addEventListener('click', loadGames);
document.getElementById('cancelBtn').addEventListener('click', cancelWaiting);
document.getElementById('vestiBtn').addEventListener('click', () => { document.getElementById('lobbyScreen').classList.remove('show'); document.getElementById('lockerPage').classList.add('show'); renderEffectif(); });

// ═══════════════════════════════════════════════
// DÉMARRAGE — avec délai pour laisser Supabase se charger
// ═══════════════════════════════════════════════
window.addEventListener('load', () => {
    setTimeout(checkAuth, 300);
});
