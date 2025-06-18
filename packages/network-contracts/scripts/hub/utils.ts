const testnet = ['alfajores', 'fuji', 'goerli', 'optGoerli', 'arbGoerli', 'polygonAmoy', 'peaq']
const mainnet = ['celo', 'avalanche', 'polygon', 'gnosis', 'ethereum', 'optimism', 'arbitrum']

/**
 * Maps the chain name to a unique hyperlane domain id
 */
export function chainToDomainId(name: string): number {
    switch (name) {
        case 'alfajores':
            return 44787
        case 'fuji':
            return 43113
        case 'goerli':
            return 5
        case 'gnosis':
            return 100
        case 'polygon':
            return 137
        case 'polygonAmoy':
            return 80002
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
export function chainToMailboxAddress(name: string): string {
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
 * Maps the chain name to the hyperlane interchain default paymaster address. The same for all EVM chains
 */
export function chainToDefaultPaymasterAddress(name: string): string {
    switch (true) {
        case testnet.includes(name):
            return '0xF90cB82a76492614D07B82a7658917f3aC811Ac1'
        case mainnet.includes(name):
            return '0x56f52c0A1ddcD557285f7CBc782D3d83096CE1Cc'
        default:
            throw new Error(`Unknown interchain paymaster address for ${name} chain.`)
    }
}

/**
 * Maps the chain name to the hyperlane interchain paymaster address. The same for all EVM chains
 */
export function chainToPaymasterAddress(name: string): string {
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
export function chainToQueryRouterAddress(name: string): string {
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
export function chainToEthereumRpcUrl(name: string): string {
    switch (name) {
        case 'goerli':
            return `https://goerli.infura.io/v3/${process.env.INFURA_KEY}`
        case 'optGoerli':
            return ``
        case 'polyognAmoy':
            return 'https://polygon-amoy-bor-rpc.publicnode.com'
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
export function chainToBlockExplorer(name: string): string {
    switch (name) {
        case 'polygon':
            return 'https://polygonscan.com'
        case 'polygonAmoy':
            return 'https://amoy.polygonscan.com'
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
