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
            roster = coll.roster || { starters: [], sixthMan: null };
            ownedCards = coll.owned_cards || [];
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
        if (updated.player1_roster) { opponentRoster = updated.player1_roster; opponentDeck = opponentRoster.starters.map(id => allCards.find(c => c.id === id)).filter(Boolean); sixthMan2 = allCards.find(c => c.id === opponentRoster.sixthMan) || {}; }
        if (updated.player2_roster) { opponentRoster = updated.player2_roster; opponentDeck = opponentRoster.starters.map(id => allCards.find(c => c.id === id)).filter(Boolean); sixthMan2 = allCards.find(c => c.id === opponentRoster.sixthMan) || {}; }
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
    deck1 = roster.starters.map(id => allCards.find(c => c.id === id)).filter(Boolean);
    sixthMan1 = allCards.find(c => c.id === roster.sixthMan) || { name: "6e Homme par défaut", defense: 7, rebond: 7, attaque: 7, passe: 7, power: "clutch", position: "?" };
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
        deck1 = roster.starters.map(id => allCards.find(c => c.id === id)).filter(Boolean);
        sixthMan1 = allCards.find(c => c.id === roster.sixthMan) || {};
        deck2 = opponentDeck;
        sixthMan2 = allCards.find(c => c.id === opponentRoster?.sixthMan) || {};
    } else {
        deck1 = roster.starters.map(id => allCards.find(c => c.id === id)).filter(Boolean);
        sixthMan1 = allCards.find(c => c.id === roster.sixthMan) || {};
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
            const card = document.createElement('div');
            card.className = 'intro-card';
            card.innerHTML = `
                <div class="intro-card-name">${playerData.name}</div>
                <div class="intro-card-stats">
                    🛡️ Défense: ${playerData.defense}<br>
                    🏀 Rebond: ${playerData.rebond}<br>
                    ⚡ Attaque: ${playerData.attaque}<br>
                    🎯 Passe: ${playerData.passe}
                </div>`;
            introCardsGrid.appendChild(card);
            setTimeout(() => card.classList.add('show'), 50);
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
        const card = document.createElement('div');
        card.className = `player-card ${isDisabled ? 'disabled' : ''}`;
        const powerUsed = myPlayerNumber === 1 ? gameState.powersUsed1[index] : gameState.powersUsed2[index];
        card.innerHTML = `
            <div class="player-name">${playerData.name}</div>
            <img src="${playerData.image_url || ''}" alt="${playerData.name}" style="width:100%; max-height:140px; object-fit:contain; border-radius:8px; margin:8px 0;">
            <div class="player-stats">
                Position: ${playerData.position || '?'}<br>
                🛡️ ${playerData.defense} | 🏀 ${playerData.rebond}<br>
                ⚡ ${playerData.attaque} | 🎯 ${playerData.passe}<br>
                <small style="color:${usageCount[index] >= 2 ? '#ff0000' : '#666'};">Utilisé: ${usageCount[index]}/2</small>
            </div>
            <div class="power-icon power-${playerData.power} ${powerUsed ? 'power-used' : ''}"
                 data-player-index="${index}" data-power="${playerData.power}"
                 onclick="event.stopPropagation();">
                ${powerEmojis[playerData.power] || '🔥'} ${powerNames[playerData.power] || playerData.power}
            </div>`;
        if (!isDisabled) card.addEventListener('click', () => togglePlayerSelection(index, card));
        playersGrid.appendChild(card);
    });

    if (gameState.isGameWinnerPhase) {
        const sixthManUsed = myPlayerNumber === 1 ? gameState.sixthManUsed1 : gameState.sixthManUsed2;
        const sixthMan = myPlayerNumber === 1 ? sixthMan1 : sixthMan2;
        const scoreDiff = gameState.score1 - gameState.score2;
        const canUseSixthMan = (myPlayerNumber === 1 && scoreDiff <= 0) || (myPlayerNumber === 2 && scoreDiff >= 0);
        if (canUseSixthMan && !sixthManUsed) {
            const card = document.createElement('div');
            card.className = 'player-card';
            card.style.border = '3px solid gold';
            card.style.background = 'linear-gradient(135deg, #fff9e6 0%, #ffe6b3 100%)';
            const powerUsedSM = myPlayerNumber === 1 ? gameState.powersUsed1['sixthman'] : gameState.powersUsed2['sixthman'];
            card.innerHTML = `
                <div class="player-name">⭐ ${sixthMan.name} ⭐</div>
                <img src="${sixthMan.image_url || ''}" alt="" style="width:100%; max-height:140px; object-fit:contain; border-radius:8px; margin:8px 0;">
                <div class="player-stats">
                    Position: ${sixthMan.position || '?'}<br>
                    🛡️ ${sixthMan.defense} | 🏀 ${sixthMan.rebond}<br>
                    ⚡ ${sixthMan.attaque} | 🎯 ${sixthMan.passe}<br>
                    <small style="color:#ff8800; font-weight:bold;">6E HOMME</small>
                </div>
                <div class="power-icon power-${sixthMan.power} ${powerUsedSM ? 'power-used' : ''}"
                     data-player-index="sixthman" data-power="${sixthMan.power}"
                     onclick="event.stopPropagation();">
                    ${powerEmojis[sixthMan.power] || '🔥'} ${powerNames[sixthMan.power] || sixthMan.power}
                </div>`;
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
                const card = document.createElement('div');
                card.className = 'battle-card';
                if (item === 'sixthman') { card.style.border = '3px solid gold'; card.style.background = 'linear-gradient(135deg, #fff9e6 0%, #ffe6b3 100%)'; }
                card.innerHTML = `<div class="player-name">${player.name}</div><div style="font-size:24px;font-weight:bold;color:#f5576c;">${stat}</div>`;
                battle1Cards.appendChild(card);
                setTimeout(() => card.classList.add('show'), 50);
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
                const card = document.createElement('div');
                card.className = 'battle-card';
                if (item === 'sixthman') { card.style.border = '3px solid gold'; card.style.background = 'linear-gradient(135deg, #fff9e6 0%, #ffe6b3 100%)'; }
                card.innerHTML = `<div class="player-name">${player.name}</div><div style="font-size:24px;font-weight:bold;color:#f5576c;">${stat}</div>`;
                battle2Cards.appendChild(card);
                setTimeout(() => card.classList.add('show'), 50);
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
    const revealCard   = document.getElementById('revealCard');

    // Reset
    revealPos.classList.remove('visible');
    revealLogo.classList.remove('visible');
    revealCard.classList.remove('visible');
    revealPos.textContent = '';
    revealLogo.src = '';
    revealCard.src = '';

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

    // Image de la carte
    setTimeout(() => {
        if (bestCard.image_url) {
            revealCard.src = bestCard.image_url;
            revealCard.classList.add('visible');
        }
    }, 12000);

    // ── 3. SAUVEGARDE EN BASE ────────────────────────────────
    try {
        const { data: coll } = await window.mySupabase
            .from('player_collections')
            .select('owned_cards, card_counts')
            .eq('user_id', currentUser.id)
            .single();

        let ownedList  = coll?.owned_cards  || [];
        let cardCounts = coll?.card_counts  || {}; // { cardId: count }

        for (const card of drawnCards) {
            const id = String(card.id);
            if (ownedList.includes(id)) {
                // Doublon : on incrémente le compteur
                cardCounts[id] = (cardCounts[id] || 1) + 1;
            } else {
                ownedList.push(id);
                cardCounts[id] = 1;
            }
        }

        await window.mySupabase
            .from('player_collections')
            .update({ owned_cards: ownedList, card_counts: cardCounts })
            .eq('user_id', currentUser.id);

        await loadAllCardsAndCollection();
    } catch (err) {
        console.error("Erreur sauvegarde pack :", err);
    }

    // ── 4. AFFICHAGE FIFA APRÈS LA VIDÉO ────────────────────
    const showPackResult = () => {
        overlay.classList.remove('show');
        showPackReveal(bestCard, otherCards);
    };

    video.onended = () => setTimeout(showPackResult, 1500);
    // Sécurité si la vidéo ne se termine pas
    setTimeout(() => { if (overlay.classList.contains('show')) showPackResult(); }, 28000);
}

// ── ÉCRAN FIFA : révélation des 3 cartes ────────────────────
function showPackReveal(bestCard, otherCards) {
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

    function buildCardHTML(card, revealed) {
        const score = cardScore(card);
        const color = rarityColors[card.rarity] || '#888';
        if (!revealed) {
            return `
                <div class="pack-card pack-card-hidden" data-card-id="${card.id}" style="
                    width:160px; height:220px; border-radius:12px; cursor:pointer;
                    background: linear-gradient(135deg, #1a1a2e, #16213e);
                    border:2px solid rgba(255,255,255,0.1);
                    display:flex; align-items:center; justify-content:center;
                    font-size:48px; transition:transform 0.3s;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.6);
                " onclick="revealPackCard(this, ${card.id})">
                    🏀
                </div>`;
        }
        return `
            <div class="pack-card pack-card-revealed" style="
                width:160px; min-height:220px; border-radius:12px;
                background:#fff; color:#111;
                border:3px solid ${color};
                box-shadow: 0 0 24px ${color}66;
                display:flex; flex-direction:column; align-items:center;
                padding:12px 8px; gap:6px;
                animation: cardFlip 0.5s ease-out;
            ">
                ${card.image_url
                    ? `<img src="${card.image_url}" style="width:100%;height:110px;object-fit:contain;border-radius:6px;">`
                    : `<div style="width:100%;height:110px;background:#f0f0f0;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:32px;">🏀</div>`
                }
                <div style="font-weight:700;font-size:13px;text-align:center;line-height:1.2;">${card.name}</div>
                <div style="font-size:10px;color:#666;">${card.team}</div>
                <div style="font-size:11px;color:#333;line-height:1.6;">
                    🛡️${card.defense} ⚡${card.attaque}<br>🏀${card.rebond} 🎯${card.passe}
                </div>
                <div style="font-size:10px;font-weight:700;color:${color};border:1px solid ${color};padding:2px 8px;border-radius:4px;">${card.power || ''}</div>
                <div style="font-size:9px;font-weight:700;color:${color};">★ ${card.rarity?.toUpperCase() || ''} — ${score} pts</div>
            </div>`;
    }

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

        <div style="display:flex; gap:24px; align-items:flex-end; flex-wrap:wrap; justify-content:center;">
            <!-- Meilleure carte : déjà révélée -->
            <div style="display:flex;flex-direction:column;align-items:center;gap:8px;">
                <div style="font-size:10px;letter-spacing:2px;color:#e8832a;font-weight:600;text-transform:uppercase;">Meilleure carte</div>
                ${buildCardHTML(bestCard, true)}
            </div>
            <!-- 2 autres : face cachée -->
            ${otherCards.map(card => `
                <div style="display:flex;flex-direction:column;align-items:center;gap:8px;">
                    <div style="font-size:10px;letter-spacing:2px;color:#6b6560;font-weight:600;text-transform:uppercase;">Clique pour révéler</div>
                    ${buildCardHTML(card, false)}
                </div>
            `).join('')}
        </div>

        <button onclick="closePackReveal()" style="
            padding:12px 40px;
            font-family:'Bebas Neue',sans-serif;
            font-size:16px; letter-spacing:3px; text-transform:uppercase;
            background:#e8832a; color:#0c0c0c;
            border:none; border-radius:4px; cursor:pointer;
            margin-top:8px;
        ">Fermer</button>
    `;

    // Stocker les données des cartes cachées pour la révélation au clic
    revealOverlay._otherCards = otherCards;
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

    const revealed = document.createElement('div');
    revealed.className = 'pack-card pack-card-revealed';
    revealed.style.cssText = `
        width:160px; min-height:220px; border-radius:12px;
        background:#fff; color:#111;
        border:3px solid ${color};
        box-shadow: 0 0 24px ${color}66;
        display:flex; flex-direction:column; align-items:center;
        padding:12px 8px; gap:6px;
        animation: cardFlip 0.5s ease-out;
    `;
    revealed.innerHTML = `
        ${card.image_url
            ? `<img src="${card.image_url}" style="width:100%;height:110px;object-fit:contain;border-radius:6px;">`
            : `<div style="width:100%;height:110px;background:#f0f0f0;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:32px;">🏀</div>`
        }
        <div style="font-weight:700;font-size:13px;text-align:center;line-height:1.2;">${card.name}</div>
        <div style="font-size:10px;color:#666;">${card.team}</div>
        <div style="font-size:11px;color:#333;line-height:1.6;">
            🛡️${card.defense} ⚡${card.attaque}<br>🏀${card.rebond} 🎯${card.passe}
        </div>
        <div style="font-size:10px;font-weight:700;color:${color};border:1px solid ${color};padding:2px 8px;border-radius:4px;">${card.power || ''}</div>
        <div style="font-size:9px;font-weight:700;color:${color};">★ ${card.rarity?.toUpperCase() || ''} — ${score} pts</div>
    `;
    parent.appendChild(revealed);
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
    const smContainer = document.getElementById('sixthManSlot');
    slotsContainer.innerHTML = '';
    smContainer.innerHTML = '';

    roster.starters.forEach((playerId, slotIdx) => {
        const player = allCards.find(c => c.id === playerId);
        if (!player) return;
        const slot = document.createElement('div');
        slot.className = 'effectif-slot filled';
        slot.innerHTML = `
            <span class="slot-label">Starter ${slotIdx + 1}</span>
            <img src="${player.image_url || ''}" alt="${player.name}" style="width:100%; max-height:120px; object-fit:contain; border-radius:8px; margin-bottom:8px;">
            <div class="slot-player-name">${player.name}</div>
            <div class="slot-player-team">${player.team} – ${player.position || '?'}</div>
            <div class="slot-player-stats">🛡️ ${player.defense} | 🏀 ${player.rebond}<br>⚡ ${player.attaque} | 🎯 ${player.passe}</div>
            <div class="slot-power-badge" style="background:${getPowerColor(player.power)}22; color:${getPowerColor(player.power)}; border:1px solid ${getPowerColor(player.power)};">${getPowerLabel(player.power)}</div>
            <button class="slot-change-btn" data-slot="starter" data-slot-index="${slotIdx}">🔄 Changer</button>`;
        slotsContainer.appendChild(slot);
    });

    const smPlayer = allCards.find(c => c.id === roster.sixthMan);
    if (smPlayer) {
        const smSlot = document.createElement('div');
        smSlot.className = 'effectif-slot filled';
        smSlot.innerHTML = `
            <span class="slot-label">6e Homme</span>
            <img src="${smPlayer.image_url || ''}" alt="${smPlayer.name}" style="width:100%; max-height:120px; object-fit:contain; border-radius:8px; margin-bottom:8px;">
            <div class="slot-player-name">${smPlayer.name}</div>
            <div class="slot-player-team">${smPlayer.team} – ${smPlayer.position || '?'}</div>
            <div class="slot-player-stats">🛡️ ${smPlayer.defense} | 🏀 ${smPlayer.rebond}<br>⚡ ${smPlayer.attaque} | 🎯 ${smPlayer.passe}</div>
            <div class="slot-power-badge" style="background:${getPowerColor(smPlayer.power)}22; color:${getPowerColor(smPlayer.power)}; border:1px solid ${getPowerColor(smPlayer.power)};">${getPowerLabel(smPlayer.power)}</div>
            <button class="slot-change-btn" data-slot="sixthman" data-slot-index="0">🔄 Changer</button>`;
        smContainer.appendChild(smSlot);
    }

    document.querySelectorAll('.slot-change-btn').forEach(btn => {
        btn.addEventListener('click', function() { openSwapModal(this.dataset.slot, parseInt(this.dataset.slotIndex)); });
    });
}

let swapTarget = null;
function openSwapModal(slotType, slotIndex) {
    swapTarget = { slot: slotType, index: slotIndex };
    document.getElementById('swapModalTitle').textContent = slotType === 'starter' ? `Choisir un remplaçant pour Starter ${slotIndex + 1}` : 'Choisir un nouveau 6e Homme';
    const grid = document.getElementById('swapCardsGrid');
    grid.innerHTML = '';
    ownedCards.forEach(playerId => {
        const player = allCards.find(c => c.id === playerId);
        if (!player) return;
        const isInRoster = roster.starters.includes(playerId) || roster.sixthMan === playerId;
        const card = document.createElement('div');
        card.className = `swap-card ${isInRoster ? 'in-roster' : ''}`;
        card.innerHTML = `
            <img src="${player.image_url || ''}" alt="${player.name}" style="width:100%; height:140px; object-fit:contain; border-radius:8px; margin-bottom:8px;">
            <div class="swap-name">${player.name}</div>
            <div class="swap-team">${player.team} – ${player.position || '?'}</div>
            <div class="swap-stats">🛡️ ${player.defense} | 🏀 ${player.rebond}<br>⚡ ${player.attaque} | 🎯 ${player.passe}</div>
            <div style="margin-top:5px; padding:2px 6px; border-radius:4px; font-size:9px; font-weight:bold; background:${getPowerColor(player.power)}22; color:${getPowerColor(player.power)};">${getPowerLabel(player.power)}</div>
            ${isInRoster ? '<div style="margin-top:5px; color:#ffd700; font-size:10px; font-weight:bold;">★ Dans l\'effectif</div>' : ''}`;
        if (!isInRoster) card.addEventListener('click', () => swapPlayer(playerId));
        grid.appendChild(card);
    });
    document.getElementById('swapModal').classList.add('show');
}

function swapPlayer(newPlayerIdx) {
    if (!swapTarget) return;
    if (swapTarget.slot === 'starter') roster.starters[swapTarget.index] = newPlayerIdx;
    else roster.sixthMan = newPlayerIdx;
    document.getElementById('swapModal').classList.remove('show');
    swapTarget = null;
    renderEffectif();
}

// ═══════════════════════════════════════════════
// CLASSEUR / BINDER
// ═══════════════════════════════════════════════
let binderPages = [], binderCurrentPage = 0, binderIsAnimating = false;

function buildBinderPages() {
    binderPages = [];
    const teams = [...new Set(ownedCards.map(id => { const card = allCards.find(c => c.id === id); return card ? card.team : null; }).filter(Boolean))].sort();
    const CARDS_PER_PHYSICAL_PAGE = 4;
    binderPages.push({ title: '📂 Toutes les cartes', cards: ownedCards.slice(0, CARDS_PER_PHYSICAL_PAGE) });
    for (let i = CARDS_PER_PHYSICAL_PAGE; i < ownedCards.length; i += CARDS_PER_PHYSICAL_PAGE) binderPages.push({ title: '📂 Toutes (suite)', cards: ownedCards.slice(i, i + CARDS_PER_PHYSICAL_PAGE) });
    binderPages.push({ title: '', cards: [], isSeparator: true });
    teams.forEach(team => {
        const teamCardIds = ownedCards.filter(id => { const card = allCards.find(c => c.id === id); return card && card.team === team; });
        binderPages.push({ title: '🏀 ' + team, cards: teamCardIds.slice(0, CARDS_PER_PHYSICAL_PAGE) });
        for (let i = CARDS_PER_PHYSICAL_PAGE; i < teamCardIds.length; i += CARDS_PER_PHYSICAL_PAGE) binderPages.push({ title: '🏀 ' + team + ' (suite)', cards: teamCardIds.slice(i, i + CARDS_PER_PHYSICAL_PAGE) });
    });
}

function renderPageContent(pageIndex) {
    if (pageIndex < 0 || pageIndex >= binderPages.length) return '<div class="page-content" style="background:transparent;"></div>';
    const page = binderPages[pageIndex];
    if (page.isSeparator) return '<div class="page-content" style="display:flex;align-items:center;justify-content:center;"><div style="color:#1e3c72;font-size:13px;opacity:0.4;font-style:italic;">— fin de la collection générale —</div></div>';
    let cardsHTML = '';
    page.cards.forEach(playerId => {
        const player = allCards.find(c => c.id === playerId);
        if (!player) return;
        const isInRoster = roster.starters.includes(playerId) || roster.sixthMan === playerId;
        cardsHTML += `
            <div class="binder-card">
                ${isInRoster ? '<div class="col-in-roster">★ Effectif</div>' : ''}
                <img src="${player.image_url || ''}" alt="${player.name}" style="width:100%; height:100px; object-fit:contain; border-radius:6px; margin-bottom:6px;">
                <div class="col-name">${player.name}</div>
                <div class="col-team">${player.team} – ${player.position || '?'}</div>
                <div class="col-stats">🛡️ ${player.defense} | 🏀 ${player.rebond}<br>⚡ ${player.attaque} | 🎯 ${player.passe}</div>
                <div class="col-power" style="background:${getPowerColor(player.power)}22; color:${getPowerColor(player.power)};">${getPowerLabel(player.power)}</div>
            </div>`;
    });
    return `<div class="page-content"><div class="page-title">${page.title}</div><div class="page-cards-grid">${cardsHTML}</div></div>`;
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

function renderCollection() { buildBinderPages(); binderCurrentPage = 0; renderBinder(); }

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
