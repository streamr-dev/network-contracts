import { config } from './generated/config'

type ContractAddressKey = typeof config extends Record<
    any,
    Record<'contracts', Partial<Record<infer K, string>>>
>
    ? K
    : never

export type Chain = Readonly<{
    adminPrivateKey?: string
    blockExplorerUrl?: string
    contracts: Partial<Record<ContractAddressKey, string>>
    entryPoints?: Readonly<
        {
            nodeId: string
            websocket: Readonly<{
                host: string
                port: number
                tls: boolean
            }>
        }[]
    >
    id: number
    name: string
    nativeCurrency: Readonly<{
        decimals: number
        name: string
        symbol: string
    }>
    rpcEndpoints: Readonly<
        {
            url: string
        }[]
    >
    theGraphUrl?: string
}>

export type ChainKey = typeof config extends Record<infer Key, unknown>
    ? Key
    : never

export type Config = Record<ChainKey, Chain>

export { config }

/**
 * The following line makes sure the format of the source json file matches
 * the types. It's a validation step. Keep it.
 */
config as Config
