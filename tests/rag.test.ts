import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { searchImages } from '../src/rag';

const testDir = path.join(__dirname, '.test-images');

describe('searchImages', () => {
  before(() => {
    // Create test directory structure
    fs.mkdirSync(path.join(testDir, '20260602'), { recursive: true });
    fs.mkdirSync(path.join(testDir, '20260603'), { recursive: true });

    // Create test image files
    fs.writeFileSync(path.join(testDir, '20260602', '20260602120000_粉色兔子钥匙扣.jpg'), '');
    fs.writeFileSync(path.join(testDir, '20260603', '20260603100000_长耳兔子毛绒玩具钥匙扣.jpg'), '');
    fs.writeFileSync(path.join(testDir, '20260603', '20260603110000_可爱卡通长耳朵兔子挂件.jpg'), '');
    fs.writeFileSync(path.join(testDir, '20260603', '20260603120000_猫咪抱枕.png'), '');

    // Override config
    const config = require('../src/config').config;
    config.imageSaveDir = testDir;
  });

  after(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should find images matching query', () => {
    const results = searchImages('兔子');
    assert.equal(results.length, 3);
    assert.ok(results[0].fileName.includes('兔子'));
  });

  it('should be case-insensitive', () => {
    const results = searchImages('RABBIT');
    // No English matches expected
    assert.equal(results.length, 0);
  });

  it('should match partial keywords', () => {
    const results = searchImages('钥匙');
    assert.equal(results.length, 2);
  });

  it('should return empty for no matches', () => {
    const results = searchImages('不存在的关键词');
    assert.equal(results.length, 0);
  });

  it('should respect limit parameter', () => {
    const results = searchImages('兔子', 1);
    assert.equal(results.length, 1);
  });

  it('should return results sorted by date descending', () => {
    const results = searchImages('兔子');
    assert.equal(results.length, 3);
    // Most recent folder first
    assert.ok(results[0].folder >= results[results.length - 1].folder);
  });

  it('should return correct relativePath format', () => {
    const results = searchImages('猫咪');
    assert.equal(results.length, 1);
    assert.ok(results[0].relativePath.startsWith('20260603/'));
    assert.ok(results[0].relativePath.endsWith('.png'));
  });
});
