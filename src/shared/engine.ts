// Regelmotor van Peloton Panic: een pure reducer over GameState.
// reduce(state, action) wijzigt de invoer nooit en gooit een RuleError bij een illegale zet.
//
// Een seizoen = 3 etappes. Elke etappe: draft (kaarten kiezen) -> team (voorbereiden,
// winkelen, trainen, ruilen) -> race (per ronde: Rustig / Normaal / Alles geven) -> uitslag.
//
// De code staat per fase in ./rules; dit bestand houdt het publieke adres van de motor.

export * from './rules/base';
export * from './rules/setup';
export * from './rules/calc';
export * from './rules/reducer';
export * from './rules/lobby';
export * from './rules/recruit';
export * from './rules/draft';
export * from './rules/trade';
export * from './rules/race';
export * from './rules/results';
export * from './rules/views';
export * from './rules/bots';
