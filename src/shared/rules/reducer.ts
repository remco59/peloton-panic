// De reducer: (state, action) -> state.

import { BRIEFING } from '../content';
import { RECRUIT_PICKS } from '../types';
import type { Action, GameState } from '../types';
import { RuleError } from './base';
import { currentDraftTeam, teamOf } from './calc';
import { advanceDraft, autoPick, buy, draftPick, install, sabotage, train } from './draft';
import { join, setKopman, start } from './lobby';
import { afterResolve, resolveRound, setEfforts, startRace } from './race';
import { botShopStep, endNaming, endRecruit, endSponsors, nameRiders, recruitBuy, startRecruit } from './recruit';
import { afterResults, rematch } from './results';
import { offer, respond } from './trade';

// ---- Reducer -----------------------------------------------------------------

export function reduce(prev: GameState, action: Action): GameState {
  const s = structuredClone(prev) as GameState;
  switch (action.type) {
    case 'join':
      return join(s, action.name, !!action.isBot);
    case 'recruit':
      return recruitBuy(s, action.teamId, action.itemId);
    case 'nameRiders':
      return nameRiders(s, action.teamId, action.names);
    case 'setTutorial':
      if (s.phase !== 'lobby') throw new RuleError('De tutorial kies je voor de start');
      s.tutorial = action.on;
      return s;
    case 'setCommentary':
      if (s.phase !== 'lobby') throw new RuleError('Het commentaar kies je voor de start');
      s.commentary = action.on;
      return s;
    case 'start':
      return start(s);
    case 'briefPage': {
      if (s.phase !== 'briefing' || !s.briefing) throw new RuleError('Er is nu geen uitleg');
      s.briefing.page = Math.max(0, Math.min(BRIEFING.length - 1, Math.round(action.page)));
      return s;
    }
    case 'briefOk': {
      if (s.phase !== 'briefing' || !s.briefing) throw new RuleError('Er is nu geen uitleg');
      teamOf(s, action.teamId);
      s.briefing.ok[action.teamId] = action.on;
      return s;
    }
    case 'briefDone': {
      if (s.phase !== 'briefing') throw new RuleError('Er is nu geen uitleg');
      s.briefing = null;
      startRecruit(s);
      return s;
    }
    case 'kopman':
      return setKopman(s, action.teamId, action.riderId);
    case 'draftPick':
      return draftPick(s, action.teamId, action.source);
    case 'draftSkip':
      if (s.phase !== 'draft' || currentDraftTeam(s) !== action.teamId) throw new RuleError('Je bent niet aan de beurt');
      advanceDraft(s);
      return s;
    case 'buy':
      return buy(s, action.teamId, action.source);
    case 'train':
      return train(s, action.teamId, action.cardId, action.riderId);
    case 'install':
      return install(s, action.teamId, action.cardId, action.replaceDef);
    case 'sabotage':
      return sabotage(s, action.teamId, action.cardId, action.targetTeamId);
    case 'offer':
      return offer(s, action);
    case 'withdraw':
      s.offers = s.offers.filter((o) => o.from !== action.teamId);
      return s;
    case 'respond':
      return respond(s, action.teamId, action.offerId, action.accept);
    case 'ready':
      if (s.phase !== 'team' && s.phase !== 'naming' && s.phase !== 'recruit' && s.phase !== 'sponsors')
        throw new RuleError('Nu kun je niet klaarzetten');
      if (s.phase === 'recruit' && teamOf(s, action.teamId).riderIds.length < RECRUIT_PICKS)
        throw new RuleError(`Kies eerst ${RECRUIT_PICKS} renners`);
      teamOf(s, action.teamId);
      s.ready[action.teamId] = true;
      if (s.teams.every((t) => s.ready[t.id])) {
        if (s.phase === 'sponsors') endSponsors(s);
        else if (s.phase === 'recruit') endRecruit(s);
        else if (s.phase === 'naming') endNaming(s);
        else startRace(s);
      }
      return s;
    case 'unready':
      if (s.phase === 'team' || s.phase === 'naming' || s.phase === 'recruit' || s.phase === 'sponsors') s.ready[action.teamId] = false;
      return s;
    case 'effort':
      return setEfforts(s, action.teamId, action.efforts, action.car, action.plays);
    case 'unlock':
      if (s.phase === 'race') s.locked[action.teamId] = false;
      return s;
    case 'next':
      if (s.phase === 'resolve') afterResolve(s);
      return s;
    case 'nextStage':
      if (s.phase === 'results') afterResults(s);
      return s;
    case 'timeout':
      return timeout(s);
    case 'rematch':
      return rematch(s);
    case 'removeBot': {
      if (s.phase !== 'lobby') throw new RuleError('Bots verwijder je alleen in de lobby');
      const last = s.teams[s.teams.length - 1];
      if (!last?.isBot) throw new RuleError('Geen bot om te verwijderen');
      s.teams.pop();
      s.riders = s.riders.filter((r) => r.teamId !== last.id);
      return s;
    }
  }
}

export function timeout(s: GameState): GameState {
  switch (s.phase) {
    case 'sponsors':
    case 'recruit': {
      // Wie nog niet klaar is, krijgt een winkelbezoek op de automatische piloot.
      for (const t of s.teams) {
        for (let guard = 0; guard < 12 && !s.ready[t.id]; guard++) {
          const a = botShopStep(s, t.id, () => 0.5);
          if (!a) break;
          if (a.type === 'recruit') recruitBuy(s, t.id, a.itemId);
          else s.ready[t.id] = true;
        }
      }
      if (s.phase === 'sponsors') endSponsors(s);
      else endRecruit(s);
      break;
    }
    case 'naming':
      endNaming(s); // wie geen naam gaf, houdt de willekeurige namen
      break;
    case 'draft': {
      const teamId = currentDraftTeam(s);
      if (teamId) autoPick(s, teamId);
      break;
    }
    case 'team':
      startRace(s);
      break;
    case 'race':
      resolveRound(s);
      break;
    case 'resolve':
      afterResolve(s);
      break;
    case 'results':
      afterResults(s);
      break;
  }
  return s;
}
