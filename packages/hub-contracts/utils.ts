/**
 * Maps the chain name to a unique hyperlane domain id
 */
export function chainToDomainId(name: string) {
    switch (name) {
        case 'alfajores':
            return 1000
        case 'optGoerli':
            return 420
        default:
            throw new Error('Unknown domain id for the given chain name.')
    }
}

/**
 * Maps the chain name to the hyperlane outbox address. Unique per chain.
 */
export function chainToOutboxAddress(name: string) {
    switch (name) {
        case 'mumbai':
            return '0xe17c37212d785760E8331D4A4395B17b34Ba8cDF'
        case 'fuji':
            return '0xc507A7c848b59469cC44A3653F8a582aa8BeC71E'
        case 'goerli':
            return '0xDDcFEcF17586D08A5740B7D91735fcCE3dfe3eeD'
        case 'optGoerli':
            return '0x54148470292C24345fb828B003461a9444414517'
        default:
            throw new Error('Unknown outbox address for the given chain name.')
    }
}

/**
 * Maps the chain name to the ethereum RPC URL. It appends the ethereum provider (e.g. infura) to the public rpc.
 */
export function chainToEthereumRpcUrl(name: string) {
    switch (name) {
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
        case 'fuji':
            return 'https://testnet.snowtrace.io/'
        default:
            throw new Error('Unknown block explorer for the given chain name.')
    }
}

export const queryRouterAddressTestchain = '0x6141e7E7fA2c1beB8be030B0a7DB4b8A10c7c3cd' // the same on all chains
