// node gen-corpus.cjs <dir> <lines> : writes a deterministic code-like repo (~200 lines/file)
const fs = require('node:fs')
const path = require('node:path')
const gen = require('../../docs/research/bench/corpus.js')
const [dir, n] = [process.argv[2], Number(process.argv[3] || 1_000_000)]
const lines = gen(n)
const per = 200
fs.rmSync(dir, { recursive: true, force: true })
let f = 0
for (let i = 0; i < n; i += per) {
  const d = path.join(dir, 'src', 'm' + (f % 50), 'p' + (f % 7))
  fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(path.join(d, `file${f++}.ts`), lines.slice(i, i + per).join('\n') + '\n')
}
console.log('files', f, 'lines', n)
