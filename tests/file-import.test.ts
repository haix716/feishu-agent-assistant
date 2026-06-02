import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeFileName, getFileExtension, getImportTargetType } from '../src/util';

describe('sanitizeFileName', () => {
  it('removes path separators and special characters', () => {
    assert.equal(sanitizeFileName('my/file:name*.xlsx'), 'myfilename.xlsx');
  });

  it('trims whitespace', () => {
    assert.equal(sanitizeFileName('  report  '), 'report');
  });

  it('collapses consecutive dots', () => {
    assert.equal(sanitizeFileName('file..name...docx'), 'file.name.docx');
  });

  it('returns fallback for empty result', () => {
    assert.equal(sanitizeFileName('///...'), 'untitled');
  });

  it('keeps normal filenames intact', () => {
    assert.equal(sanitizeFileName('quarterly-report_2024.xlsx'), 'quarterly-report_2024.xlsx');
  });
});

describe('getFileExtension', () => {
  it('returns lowercase extension without dot', () => {
    assert.equal(getFileExtension('report.XLSX'), 'xlsx');
  });

  it('returns empty string for no extension', () => {
    assert.equal(getFileExtension('Makefile'), '');
  });

  it('handles multiple dots', () => {
    assert.equal(getFileExtension('archive.tar.gz'), 'gz');
  });
});

describe('getImportTargetType', () => {
  it('xlsx maps to sheet', () => {
    assert.equal(getImportTargetType('xlsx'), 'sheet');
  });

  it('xls maps to sheet', () => {
    assert.equal(getImportTargetType('xls'), 'sheet');
  });

  it('csv maps to sheet', () => {
    assert.equal(getImportTargetType('csv'), 'sheet');
  });

  it('docx maps to docx', () => {
    assert.equal(getImportTargetType('docx'), 'docx');
  });

  it('doc maps to docx', () => {
    assert.equal(getImportTargetType('doc'), 'docx');
  });

  it('unsupported extension returns null', () => {
    assert.equal(getImportTargetType('pdf'), null);
  });

  it('empty string returns null', () => {
    assert.equal(getImportTargetType(''), null);
  });
});
