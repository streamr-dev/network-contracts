import prettier from 'prettier'
import fs from 'fs'

const json = JSON.parse(fs.readFileSync('config.json', 'utf8'))

const items = [
    '/* eslint-disable */',
    '/* This file has been generated with `npm run generate-types` */',
    '',
    `export const config = ${JSON.stringify(json)} as const`,
]

const code = items.join('\n')

const formattedCode = await prettier.format(code, {
    parser: 'typescript',
    singleQuote: true,
    semi: false,
    tabWidth: 4,
})

if (!fs.existsSync('./src/generated')) {
    fs.mkdirSync('./src/generated')
}

fs.writeFileSync('./src/generated/config.ts', formattedCode)
