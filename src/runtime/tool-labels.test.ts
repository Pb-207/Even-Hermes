import { describe, it, expect } from 'vitest';
import { toolLabel } from './tool-labels';

describe('toolLabel', () => {
  it('maps search-like tools to "searching"', () => {
    expect(toolLabel('search')).toBe('searching');
    expect(toolLabel('web_search')).toBe('searching');
    expect(toolLabel('google_search')).toBe('searching');
  });

  it('maps execution-like tools to "running"', () => {
    expect(toolLabel('terminal')).toBe('running');
    expect(toolLabel('run')).toBe('running');
    expect(toolLabel('execute_code')).toBe('running');
    expect(toolLabel('shell')).toBe('running');
    expect(toolLabel('bash')).toBe('running');
  });

  it('maps read-like tools to "reading"', () => {
    expect(toolLabel('read_file')).toBe('reading');
    expect(toolLabel('read')).toBe('reading');
  });

  it('maps fetch-like tools to "fetching"', () => {
    expect(toolLabel('fetch')).toBe('fetching');
    expect(toolLabel('http_request')).toBe('fetching');
    expect(toolLabel('browse')).toBe('fetching');
  });

  it('falls back to "working" for anything unknown', () => {
    expect(toolLabel('do_something_weird')).toBe('working');
    expect(toolLabel('')).toBe('working');
  });

  it('is case-insensitive', () => {
    expect(toolLabel('WEB_SEARCH')).toBe('searching');
    expect(toolLabel('Terminal')).toBe('running');
  });
});
