import { NormalizedEvent } from '../models/normalizedEvent.js';
import { parseHikvisionEvent } from './hikvisionParser.js';

export type ParserFn = (payload: unknown) => NormalizedEvent;

const parsers: Record<string, ParserFn> = {
  hikvision: parseHikvisionEvent,
};

export function registerParser(source: string, parser: ParserFn): void {
  parsers[source.toLowerCase()] = parser;
}

export function getParser(source: string): ParserFn | undefined {
  return parsers[source.toLowerCase()];
}
