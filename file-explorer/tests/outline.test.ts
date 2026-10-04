import { describe, expect, test } from 'claude-code/testing'
import { hasOutline, outlineOf } from '../hooks/outline'
import { markdownHeadings } from '../hooks/markdown'

const brief = (path: string, text: string) =>
  outlineOf(path, text).map(one => `${one.line}-${one.end} ${'  '.repeat(one.depth)}${one.kind} ${one.name}`)

describe('markdown', () => {
  test('headings outside fences, with lines and depth from the top level', () => {
    const text = ['## Intro', 'text', '```', '# not a heading', '```', '### Detail', '', '## **Usage**', 'more', ''].join('\n')
    expect(markdownHeadings(text).map(one => one.line)).toEqual([1, 6, 8])
    expect(brief('README.md', text)).toEqual(['1-6 heading Intro', '6-6   heading Detail', '8-9 heading Usage'])
  })
})

describe('TypeScript and JavaScript', () => {
  test('functions, classes, types, arrow consts, exported consts and methods', () => {
    const text = [
      'import x from "y"',
      'export async function load(a: string) {',
      '  if (a) {',
      '    return 1',
      '  }',
      '}',
      '/*',
      'function hidden() {}',
      '*/',
      'export default class Store<T> extends Base {',
      '  private async get(key: string): Promise<T> {',
      '    for (const one of this.all) {',
      '    }',
      '  }',
      '  static make() {',
      '  }',
      '}',
      'export type Id = string',
      'interface Shape { size: number }',
      'const add = (a: number, b: number): number => a + b',
      'export const LIMIT = 10',
      'const plain = 3',
    ].join('\n')
    expect(brief('src/store.ts', text)).toEqual([
      '2-6 function load',
      '10-17 class Store',
      '11-14   method get',
      '15-16   method make',
      '18-18 type Id',
      '19-19 type Shape',
      '20-20 function add',
      '21-22 const LIMIT',
    ])
  })
})

describe('other languages', () => {
  test('Python defs and classes nest by indentation', () => {
    const text = ['class A:', '    def f(self):', '        pass', '', 'async def main():', '    pass', ''].join('\n')
    expect(brief('app.py', text)).toEqual(['1-3 class A', '2-3   function f', '5-6 function main'])
  })

  test('Go funcs with receivers and types', () => {
    const text = ['package x', 'type Server struct {}', 'func (s *Server) Run() error {', '}', 'func main() {', '}'].join('\n')
    expect(brief('main.go', text).map(line => line.replace(/^\S+ /, ''))).toEqual([
      'type Server',
      'function (s *Server) Run',
      'function main',
    ])
  })

  test('Rust fns, types, impls and mods', () => {
    const text = ['pub struct Point;', 'impl Display for Point {', '    pub fn fmt(&self) {}', '}', 'mod tests {', '    fn it() {}', '}'].join('\n')
    expect(brief('lib.rs', text).map(line => line.replace(/^\S+ /, ''))).toEqual([
      'type Point',
      'class Display for Point',
      '  function fmt',
      'module tests',
      '  function it',
    ])
  })

  test('nothing for other files, and names are made safe', () => {
    expect(hasOutline('notes.txt')).toBe(false)
    expect(hasOutline('a.TS')).toBe(true)
    expect(outlineOf('notes.txt', 'function a() {}')).toEqual([])
    expect(outlineOf('a.md', '# Bad\u001b[2J name')[0]?.name).toBe('Bad?[2J name')
  })
})
