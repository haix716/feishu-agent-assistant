import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatFileList, parseFileCommand } from '../src/util.ts';

describe('formatFileList', () => {
  it('格式化空列表', () => {
    const result = formatFileList([]);
    assert.equal(result, '当前群文件夹为空');
  });

  it('格式化单个文件', () => {
    const files = [
      { name: 'readme.md', type: 'doc', size: 1024, url: 'https://example.com/1', token: 'tok1' },
    ];
    const result = formatFileList(files);
    assert.ok(result.includes('readme.md'));
    assert.ok(result.includes('1.0KB'));
    assert.ok(result.includes('1 个'));
  });

  it('格式化多个文件', () => {
    const files = [
      { name: 'a.txt', type: 'doc', size: 512, url: 'https://example.com/1', token: 'tok1' },
      { name: 'b.pdf', type: 'pdf', size: 2048000, url: 'https://example.com/2', token: 'tok2' },
      { name: 'c.png', type: 'image', size: 307200, url: 'https://example.com/3', token: 'tok3' },
    ];
    const result = formatFileList(files);
    assert.ok(result.includes('3 个'));
    assert.ok(result.includes('a.txt'));
    assert.ok(result.includes('b.pdf'));
    assert.ok(result.includes('c.png'));
    assert.ok(result.includes('2000.0KB') || result.includes('1.95MB'));
  });

  it('超过 10 个文件只显示前 10 个', () => {
    const files = Array.from({ length: 15 }, (_, i) => ({
      name: `file${i}.txt`,
      type: 'doc',
      size: 100,
      url: `https://example.com/${i}`,
      token: `tok${i}`,
    }));
    const result = formatFileList(files);
    assert.ok(result.includes('15 个'));
    assert.ok(result.includes('file0.txt'));
    assert.ok(result.includes('file9.txt'));
    assert.ok(!result.includes('file10.txt'));
  });

  it('格式化文件大小：字节', () => {
    const files = [
      { name: 'tiny.txt', type: 'doc', size: 500, url: '', token: 'tok1' },
    ];
    const result = formatFileList(files);
    assert.ok(result.includes('500B'));
  });

  it('格式化文件大小：MB', () => {
    const files = [
      { name: 'big.bin', type: 'doc', size: 5 * 1024 * 1024, url: '', token: 'tok1' },
    ];
    const result = formatFileList(files);
    assert.ok(result.includes('5.00MB'));
  });
});

describe('parseFileCommand', () => {
  it('解析「读文件 xxx」', () => {
    assert.equal(parseFileCommand('读文件 readme.md'), 'readme.md');
  });

  it('解析「读文件xxx」（无空格）', () => {
    assert.equal(parseFileCommand('读文件data.csv'), 'data.csv');
  });

  it('解析带前后空格的文件名', () => {
    assert.equal(parseFileCommand('读文件  report.pdf  '), 'report.pdf');
  });

  it('不匹配普通消息', () => {
    assert.equal(parseFileCommand('你好'), null);
  });

  it('不匹配部分匹配', () => {
    assert.equal(parseFileCommand('帮我读文件 xxx'), null);
  });

  it('不匹配空文件名', () => {
    assert.equal(parseFileCommand('读文件'), null);
  });

  it('不匹配「读文件 」后只有空格', () => {
    assert.equal(parseFileCommand('读文件   '), null);
  });

  it('解析群聊中带 @mention 的消息', () => {
    assert.equal(parseFileCommand('@_user_1 读文件 test.txt'), 'test.txt');
  });

  it('解析「群文件」指令返回 null', () => {
    assert.equal(parseFileCommand('群文件'), null);
  });
});
