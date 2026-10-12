import {cacheWeights} from './cache-weights.js';
export const weights=(value:unknown)=>cacheWeights(value).words;
