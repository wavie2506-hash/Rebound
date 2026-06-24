-- ═══════════════════════════════════════════════════════════
-- REBOUND — Système de monnaie + Pass Culture
-- À exécuter une fois dans l'éditeur SQL Supabase (SQL Editor)
-- À exécuter APRÈS le script de schéma principal (profiles, player_collections, games)
-- ═══════════════════════════════════════════════════════════

-- ── 1. Extension player_collections ─────────────────────────
alter table public.player_collections
    add column if not exists credits int not null default 0,
    add column if not exists tokens int not null default 0,
    add column if not exists xp int not null default 0,
    add column if not exists pass_level int not null default 0;

-- ── 2. Table de référence : paliers du pass ─────────────────
create table if not exists public.pass_tiers (
    level int primary key,
    xp_required int not null,
    reward_type text not null check (reward_type in ('credits', 'tokens', 'pack')),
    reward_amount int not null default 0,
    pack_type text
);

truncate table public.pass_tiers;
insert into public.pass_tiers (level, xp_required, reward_type, reward_amount, pack_type) values
    (1,  100,  'credits', 50,  null),
    (2,  200,  'tokens',  15,  null),
    (3,  300,  'credits', 75,  null),
    (4,  400,  'tokens',  20,  null),
    (5,  500,  'pack',    1,   'basic'),
    (6,  600,  'credits', 80,  null),
    (7,  700,  'tokens',  20,  null),
    (8,  800,  'credits', 90,  null),
    (9,  900,  'tokens',  25,  null),
    (10, 1000, 'pack',    1,   'basic'),
    (11, 1100, 'credits', 100, null),
    (12, 1200, 'tokens',  25,  null),
    (13, 1300, 'credits', 110, null),
    (14, 1400, 'tokens',  30,  null),
    (15, 1500, 'pack',    1,   'premium'),
    (16, 1600, 'credits', 120, null),
    (17, 1700, 'tokens',  30,  null),
    (18, 1800, 'credits', 130, null),
    (19, 1900, 'tokens',  30,  null),
    (20, 2000, 'pack',    1,   'premium');

-- ── 3. Table de référence : catalogue de quêtes ─────────────
create table if not exists public.daily_quests_catalog (
    id int primary key generated always as identity,
    code text unique not null,
    label text not null,
    quest_type text not null check (quest_type in ('play_game', 'win_game', 'open_pack')),
    target_count int not null default 1,
    xp_reward int not null default 0,
    tokens_reward int not null default 0
);

insert into public.daily_quests_catalog (code, label, quest_type, target_count, xp_reward, tokens_reward)
values
    ('play_1', 'Jouer 1 partie', 'play_game', 1, 20, 0),
    ('win_1',  'Gagner 1 partie', 'win_game', 1, 30, 20),
    ('pack_1', 'Ouvrir 1 pack', 'open_pack', 1, 20, 0)
on conflict (code) do nothing;

-- ── 4. Quêtes du jour assignées par joueur ──────────────────
create table if not exists public.player_daily_quests (
    user_id uuid not null references auth.users(id) on delete cascade,
    quest_date date not null,
    quest_id int not null references public.daily_quests_catalog(id),
    progress int not null default 0,
    claimed boolean not null default false,
    primary key (user_id, quest_date, quest_id)
);

alter table public.player_daily_quests enable row level security;
drop policy if exists "own daily quests" on public.player_daily_quests;
create policy "own daily quests" on public.player_daily_quests
    for select using (auth.uid() = user_id);

-- ── 5. Calendrier de connexion ──────────────────────────────
create table if not exists public.player_daily_login (
    user_id uuid primary key references auth.users(id) on delete cascade,
    last_claim_date date,
    streak_day int not null default 0
);

alter table public.player_daily_login enable row level security;
drop policy if exists "own daily login" on public.player_daily_login;
create policy "own daily login" on public.player_daily_login
    for select using (auth.uid() = user_id);

-- ── 6. RPC : assigner les 3 quêtes du jour si absentes ──────
create or replace function public.get_or_create_daily_quests()
returns table (quest_id int, code text, label text, quest_type text, target_count int,
               xp_reward int, tokens_reward int, progress int, claimed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_today date := current_date;
    v_count int;
begin
    if v_user is null then
        raise exception 'Non authentifié';
    end if;

    select count(*) into v_count from public.player_daily_quests
        where user_id = v_user and quest_date = v_today;

    if v_count = 0 then
        insert into public.player_daily_quests (user_id, quest_date, quest_id)
        select v_user, v_today, id
        from public.daily_quests_catalog
        order by random()
        limit 3;
    end if;

    return query
    select pdq.quest_id, dqc.code, dqc.label, dqc.quest_type, dqc.target_count,
           dqc.xp_reward, dqc.tokens_reward, pdq.progress, pdq.claimed
    from public.player_daily_quests pdq
    join public.daily_quests_catalog dqc on dqc.id = pdq.quest_id
    where pdq.user_id = v_user and pdq.quest_date = v_today;
end;
$$;

-- ── 7. RPC : incrémenter la progression des quêtes du jour ──
create or replace function public.increment_quest_progress(p_quest_type text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_today date := current_date;
begin
    if v_user is null then
        raise exception 'Non authentifié';
    end if;

    update public.player_daily_quests pdq
    set progress = pdq.progress + 1
    from public.daily_quests_catalog dqc
    where pdq.quest_id = dqc.id
      and pdq.user_id = v_user
      and pdq.quest_date = v_today
      and dqc.quest_type = p_quest_type
      and pdq.claimed = false
      and pdq.progress < dqc.target_count;
end;
$$;

-- ── 8. RPC : réclamer une quête terminée ────────────────────
create or replace function public.claim_daily_quest(p_quest_id int)
returns table (xp_gained int, tokens_gained int)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_today date := current_date;
    v_row public.player_daily_quests;
    v_cat public.daily_quests_catalog;
begin
    if v_user is null then
        raise exception 'Non authentifié';
    end if;

    select * into v_row from public.player_daily_quests
        where user_id = v_user and quest_date = v_today and quest_id = p_quest_id
        for update;

    if v_row is null then
        raise exception 'Quête introuvable';
    end if;
    if v_row.claimed then
        raise exception 'Quête déjà réclamée';
    end if;

    select * into v_cat from public.daily_quests_catalog where id = p_quest_id;

    if v_row.progress < v_cat.target_count then
        raise exception 'Quête non terminée';
    end if;

    update public.player_daily_quests set claimed = true
        where user_id = v_user and quest_date = v_today and quest_id = p_quest_id;

    update public.player_collections
        set xp = xp + v_cat.xp_reward,
            tokens = tokens + v_cat.tokens_reward
        where user_id = v_user;

    return query select v_cat.xp_reward, v_cat.tokens_reward;
end;
$$;

-- ── 9. RPC : réclamer le bonus de connexion quotidien ───────
create or replace function public.claim_daily_login()
returns table (streak_day int, tokens_gained int)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_today date := current_date;
    v_row public.player_daily_login;
    v_rewards int[] := array[5,5,10,10,15,15,25];
    v_new_streak int;
    v_reward int;
begin
    if v_user is null then
        raise exception 'Non authentifié';
    end if;

    select * into v_row from public.player_daily_login where user_id = v_user for update;

    if v_row is null then
        insert into public.player_daily_login (user_id, last_claim_date, streak_day)
        values (v_user, null, 0);
        v_row.last_claim_date := null;
        v_row.streak_day := 0;
    end if;

    if v_row.last_claim_date = v_today then
        raise exception 'Déjà réclamé aujourd''hui';
    end if;

    if v_row.last_claim_date = v_today - 1 then
        v_new_streak := v_row.streak_day + 1;
        if v_new_streak > 7 then v_new_streak := 1; end if;
    else
        v_new_streak := 1;
    end if;

    v_reward := v_rewards[v_new_streak];

    update public.player_daily_login
        set last_claim_date = v_today, streak_day = v_new_streak
        where user_id = v_user;

    update public.player_collections
        set tokens = tokens + v_reward
        where user_id = v_user;

    return query select v_new_streak, v_reward;
end;
$$;

-- ── 10. RPC : créditer l'XP de fin de partie + paliers franchis ──
create or replace function public.grant_match_xp(p_won boolean)
returns table (new_xp int, new_level int, tiers_unlocked jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_xp_gain int := case when p_won then 25 else 10 end;
    v_current public.player_collections;
    v_tier public.pass_tiers;
    v_unlocked jsonb := '[]'::jsonb;
begin
    if v_user is null then
        raise exception 'Non authentifié';
    end if;

    update public.player_collections
        set xp = xp + v_xp_gain
        where user_id = v_user
        returning * into v_current;

    for v_tier in
        select * from public.pass_tiers
        where level > v_current.pass_level and xp_required <= v_current.xp
        order by level asc
    loop
        if v_tier.reward_type = 'credits' then
            update public.player_collections set credits = credits + v_tier.reward_amount
                where user_id = v_user;
        elsif v_tier.reward_type = 'tokens' then
            update public.player_collections set tokens = tokens + v_tier.reward_amount
                where user_id = v_user;
        elsif v_tier.reward_type = 'pack' then
            -- Les jetons de pack sont ajoutés comme "crédit pack en attente" simplifié :
            -- ici on crédite directement des crédits équivalents pour rester simple
            -- (le pack lui-même reste ouvert manuellement via la Boutique/Packs).
            update public.player_collections set credits = credits + 100
                where user_id = v_user;
        end if;

        update public.player_collections set pass_level = v_tier.level where user_id = v_user;

        v_unlocked := v_unlocked || jsonb_build_object(
            'level', v_tier.level,
            'reward_type', v_tier.reward_type,
            'reward_amount', v_tier.reward_amount,
            'pack_type', v_tier.pack_type
        );
    end loop;

    select * into v_current from public.player_collections where user_id = v_user;

    return query select v_current.xp, v_current.pass_level, v_unlocked;
end;
$$;

-- ── 11. RPC : débiter des crédits pour ouvrir un pack ───────
create or replace function public.spend_credits_for_pack(p_pack_type text)
returns table (new_credits int)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_cost int;
    v_credits int;
begin
    if v_user is null then
        raise exception 'Non authentifié';
    end if;

    v_cost := case p_pack_type
        when 'basic' then 100
        when 'premium' then 250
        else null
    end;
    if v_cost is null then
        raise exception 'Type de pack inconnu';
    end if;

    select credits into v_credits from public.player_collections where user_id = v_user for update;

    if v_credits < v_cost then
        raise exception 'Crédits insuffisants';
    end if;

    update public.player_collections set credits = credits - v_cost where user_id = v_user
        returning credits into v_credits;

    return query select v_credits;
end;
$$;

-- ── 12. RPC : débiter des jetons pour booster une stat en partie ──
create or replace function public.spend_tokens(p_amount int)
returns table (new_tokens int)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_tokens int;
begin
    if v_user is null then
        raise exception 'Non authentifié';
    end if;
    if p_amount <= 0 then
        raise exception 'Montant invalide';
    end if;

    select tokens into v_tokens from public.player_collections where user_id = v_user for update;

    if v_tokens < p_amount then
        raise exception 'Jetons insuffisants';
    end if;

    update public.player_collections set tokens = tokens - p_amount where user_id = v_user
        returning tokens into v_tokens;

    return query select v_tokens;
end;
$$;
