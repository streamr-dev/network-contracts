const testnet = ['alfajores', 'fuji', 'mumbai', 'goerli', 'optGoerli', 'arbGoerli']
const mainnet = ['celo', 'avalanche', 'polygon', 'ethereum', 'optimism', 'arbitrum']

/**
 * Maps the chain name to a unique hyperlane domain id
 */
export function chainToDomainId(name: string) {
    switch (name) {
        case 'alfajores':
            return 44787
        case 'fuji':
            return 43113
        case 'goerli':
            return 5
        case 'mumbai':
            return 80001
        case 'optGoerli':
            return 420
        case 'arbGoerli':
            return 421613
        case 'dev0':
            return 8995
        case 'dev1':
            return 8997
        default:
            throw new Error(`Unknown domain id for the given chain name (${name}).`)
    }
}

/**
 * Maps the chain name to the hyperlane mailbox address. The same for all EVM chains
 */
export function chainToMailboxAddress(name: string) {
    switch (true) {
        case testnet.includes(name):
            return '0xCC737a94FecaeC165AbCf12dED095BB13F037685'
        case mainnet.includes(name):
            return '0x35231d4c2D8B8ADcB5617A638A0c4548684c7C70'
        default:
            throw new Error(`Unknown mailbox address for ${name} chain.`)
    }
}

/**
 * Maps the chain name to the hyperlane interchain paymaster address. The same for all EVM chains
 */
export function chainToPaymasterAddress(name: string) {
    switch (true) {
        case testnet.includes(name):
            return '0x8f9C3888bFC8a5B25AED115A82eCbb788b196d2a'
        case mainnet.includes(name):
            return '0x6cA0B6D22da47f091B7613223cD4BB03a2d77918'
        default:
            throw new Error(`Unknown interchain paymaster address for ${name} chain.`)
    }
}

/**
 * Maps the chain name to the hyperlane interchain query router address. The same for all EVM chains
 */
export function chainToQueryRouterAddress(name: string) {
    switch (true) {
        case testnet.includes(name):
            return '0xF782C6C4A02f2c71BB8a1Db0166FAB40ea956818'
        case mainnet.includes(name):
            return '0x234b19282985882d6d6fd54dEBa272271f4eb784'
        default:
            throw new Error(`Unknown interchain query router address for ${name} chain.`)
    }
}

/**
 * Maps the chain name to the ethereum RPC URL. It appends the ethereum provider (e.g. infura) to the public rpc.
 */
export function chainToEthereumRpcUrl(name: string) {
    switch (name) {
        case 'mumbai':
            return `https://rpc-mumbai.maticvigil.com/v1/${process.env.MATIC_API_KEY}`
        case 'goerli':
            return `https://goerli.infura.io/v3/${process.env.GOERLI_API_KEY}`
        case 'optGoerli':
            return ``
        case 'fuji':
            return `https://avalanche-fuji.infura.io/v3/${process.env.FUJI_API_KEY}`
        case 'dev1':
            return 'http://10.200.10.1:8546'
        
        default:
            throw new Error('Unknown ethereum RPC URL for the given chain name.')
    }
}

/**
 * Maps the chain name to a public block explorer.
 */
export function chainToBlockExplorer(name: string) {
    switch (name) {
        case 'polygon':
            return 'https://polygonscan.com'
        case 'mumbai':
            return 'https://mumbai.polygonscan.com'
        case 'gnosis':
            return 'https://gnosisscan.io'
        case 'goerli':
            return 'https://goerli.etherscan.io'
        case 'optGoerli':
            return 'https://goerli-optimism.etherscan.io'
        case 'fuji':
            return 'https://testnet.snowtrace.io/'
        default:
            throw new Error('Unknown block explorer for the given chain name.')
    }
}
