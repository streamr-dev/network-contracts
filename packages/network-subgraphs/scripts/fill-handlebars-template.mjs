import { readFileSync } from 'fs'
import handlebars from 'handlebars'

const readFromStdin = async () => {
    let result = ''
    for await (const chunk of process.stdin) {
        result += chunk
    }
    return result
}

const main = async () => {
    const template = readFileSync(process.argv[2], 'utf8')
    const compiled = handlebars.compile(template)
    const data = JSON.parse(await readFromStdin())
    process.stdout.write(compiled(data))
}

main()
