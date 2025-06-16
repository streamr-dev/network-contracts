/* eslint-disable quotes, no-console */

import { ethers } from 'ethers'
import * as fs from 'fs'
import * as path from 'path'

interface AbiItem {
    name: string
    inputs: {
        type: string
    }[]
    type: string
}

interface ContractArtifact {
    abi: AbiItem[]
}

const SECTION_TYPES = ['function', 'error', 'event']
const ABI_FILE_NAME_SUFFIX = '.json'
const DEBUG_FILE_NAME_SUFFIX = '.dbg.json'

function crawlDirectory(directoryPath: string): string[] {
    const results: string[] = []
    const entries = fs.readdirSync(directoryPath, { withFileTypes: true })
    for (const entry of entries) {
        const entryPath = path.join(directoryPath, entry.name)
        if (entry.isDirectory()) {
            results.push(...crawlDirectory(entryPath))
        } else if (entry.isFile()) {
            results.push(entryPath)
        }
    }
    return results
}

function generateSelectorForItem(item: AbiItem, isFunction: boolean): string {
    const signature = `${item.name}(${item.inputs.map((input) => input.type).join(',')})`
    const selector = ethers.utils.id(signature).slice(0, 10)  // first 4 bytes and the 0x prefix
    const suffix = isFunction ? '()' : ''
    return `${selector} ${item.name}${suffix}`
}

function generateSelectorsForArtifacts(filePath: string): string {
    try {
        const fileName = filePath.split('/').pop()!
        const contractName = fileName.slice(0, fileName.length - ABI_FILE_NAME_SUFFIX.length)
        const artifact: ContractArtifact = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
        return SECTION_TYPES
            .filter((sectionType) => artifact.abi.some((item) => item.type === sectionType))
            .map((sectionType) => {
                const header = `# ${contractName} ${sectionType}s`
                const items = artifact.abi.filter((item) => item.type === sectionType)
                return [header, ...items.map((item) => generateSelectorForItem(item, (sectionType === 'function')))].join('\n')
            })
            .join('\n\n')
    } catch (error) {
        console.error(`Error processing ${filePath}`)
        console.error(error)
        process.exit(1)
    }
}

console.log(crawlDirectory('artifacts/contracts')
    .filter((filePath) => !filePath.endsWith(DEBUG_FILE_NAME_SUFFIX))
    .filter((filePath) => !filePath.includes('testcontracts'))
    .map((contract) => generateSelectorsForArtifacts(contract))
    .join('\n\n\n\n'))