#!npx ts-node

import { utils, Contract, providers, Wallet, Overrides } from "ethers"
import { config } from "@streamr/config"

import { operatorFactoryABI, sponsorshipFactoryABI, streamrConfigABI } from "@streamr/network-contracts"
import type { StreamrConfig, SponsorshipFactory, OperatorFactory } from "@streamr/network-contracts"

const { log } = console

const { isAddress, getAddress, parseUnits } = utils
const { JsonRpcProvider } = providers

const {
    CHAIN,
    KEY = "",
    NEW_ADMIN_ADDRESS = "",
    GAS_PRICE_GWEI,

    SKIP_REVOKE_CONFIGURATOR,
} = process.env
if (!CHAIN) {
    throw new Error("Must set CHAIN environment variable, e.g. CHAIN=dev2")
}
if (!KEY) {
    throw new Error("Must set KEY environment variable to current admin's key, e.g. KEY=0x...")
}

const {
    contracts: {
        StreamrConfig: STREAMR_CONFIG_ADDRESS,
        OperatorFactory: OPERATOR_FACTORY_ADDRESS,
        SponsorshipFactory: SPONSORSHIP_FACTORY_ADDRESS,
    },
    rpcEndpoints: [{ url: ETHEREUM_RPC_URL }],
} = (config as any)[CHAIN]

// TODO: add to @streamr/config
const blockExplorerUrl = "https://polygonscan.com"

const txOverrides: Overrides = {}
if (GAS_PRICE_GWEI) {
    txOverrides.gasPrice = parseUnits(GAS_PRICE_GWEI, "gwei")
}

const lastArg = process.argv[process.argv.length - 1]
const targetAddress = isAddress(lastArg) ? getAddress(lastArg) : isAddress(NEW_ADMIN_ADDRESS) ? getAddress(NEW_ADMIN_ADDRESS) : null
if (targetAddress === null) {
    log("Target address can be given as command-line argument, or as TARGET_ADDRESS environment variable.")
    throw new Error("Must give target address!")
}

async function main() {
    const provider = new JsonRpcProvider(ETHEREUM_RPC_URL)
    const currentAdmin = new Wallet(KEY, provider)
    await handover(currentAdmin, targetAddress!)
}

export default async function handover(currentAdminWallet: Wallet, targetAddress: string): Promise<void> {
    const { provider } = currentAdminWallet
    const myAddress = currentAdminWallet.address

    if (!STREAMR_CONFIG_ADDRESS || await provider.getCode(STREAMR_CONFIG_ADDRESS) === "0x") {
        throw new Error(`StreamrConfig must be set in the config! Not found in chain "${CHAIN}".
            Check CHAIN environment variable, or deploy StreamrConfig first.`)
    }
    const streamrConfig = new Contract(STREAMR_CONFIG_ADDRESS, streamrConfigABI, currentAdminWallet) as StreamrConfig
    if (!await streamrConfig.hasRole(await streamrConfig.ADMIN_ROLE(), currentAdminWallet.address)) {
        throw new Error(`${currentAdminWallet.address} doesn't have StreamrConfig.ADMIN_ROLE`)
    }
    log("Found StreamrConfig at %s", streamrConfig.address)

    if (!OPERATOR_FACTORY_ADDRESS || await provider.getCode(OPERATOR_FACTORY_ADDRESS) === "0x") {
        throw new Error(`OperatorFactory must be set in the config! Not found in chain "${CHAIN}".
            Check CHAIN environment variable, or deploy OperatorFactory first.`)
    }
    const operatorFactory = new Contract(OPERATOR_FACTORY_ADDRESS, operatorFactoryABI, currentAdminWallet) as OperatorFactory
    if (!await operatorFactory.hasRole(await operatorFactory.ADMIN_ROLE(), currentAdminWallet.address)) {
        throw new Error(`${currentAdminWallet.address} doesn't have OperatorFactory.ADMIN_ROLE`)
    }
    log("Found OperatorFactory at %s", operatorFactory.address)

    if (!SPONSORSHIP_FACTORY_ADDRESS || await provider.getCode(SPONSORSHIP_FACTORY_ADDRESS) === "0x") {
        throw new Error(`SponsorshipFactory must be set in the config! Not found in chain "${CHAIN}".
            Check CHAIN environment variable, or deploy SponsorshipFactory first.`)
    }
    const sponsorshipFactory = new Contract(SPONSORSHIP_FACTORY_ADDRESS, sponsorshipFactoryABI, currentAdminWallet) as SponsorshipFactory
    if (!await sponsorshipFactory.hasRole(await sponsorshipFactory.ADMIN_ROLE(), currentAdminWallet.address)) {
        throw new Error(`${currentAdminWallet.address} doesn't have SponsorshipFactory.ADMIN_ROLE`)
    }
    log("Found SponsorshipFactory at %s", sponsorshipFactory.address)

    const tr0 = await (await streamrConfig.setProtocolFeeBeneficiary(targetAddress, txOverrides)).wait()
    log("Set StreamrConfig.protocolFeeBeneficiary to %s (%s/tx/%s )", targetAddress, blockExplorerUrl, tr0.transactionHash)
    const tr1 = await (await streamrConfig.grantRole(await streamrConfig.ADMIN_ROLE(), targetAddress, txOverrides)).wait()
    log("Granted StreamrConfig.ADMIN_ROLE to %s (%s/tx/%s )", targetAddress, blockExplorerUrl, tr1.transactionHash)
    const tr2 = await (await streamrConfig.grantRole(await streamrConfig.CONFIGURATOR_ROLE(), targetAddress, txOverrides)).wait()
    log("Granted StreamrConfig.CONFIGURATOR_ROLE to %s (%s/tx/%s )", targetAddress, blockExplorerUrl, tr2.transactionHash)
    const tr3 = await (await streamrConfig.grantRole(await streamrConfig.UPGRADER_ROLE(), targetAddress, txOverrides)).wait()
    log("Granted StreamrConfig.UPGRADER_ROLE to %s (%s/tx/%s )", targetAddress, blockExplorerUrl, tr3.transactionHash)
    if (!SKIP_REVOKE_CONFIGURATOR) {
        const tr4 = await (await streamrConfig.revokeRole(await streamrConfig.CONFIGURATOR_ROLE(), myAddress, txOverrides)).wait()
        log("Revoked StreamrConfig.CONFIGURATOR_ROLE from %s (%s/tx/%s )", myAddress, blockExplorerUrl, tr4.transactionHash)
    }
    const tr5 = await (await streamrConfig.revokeRole(await streamrConfig.UPGRADER_ROLE(), myAddress, txOverrides)).wait()
    log("Revoked StreamrConfig.UPGRADER_ROLE from %s (%s/tx/%s )", myAddress, blockExplorerUrl, tr5.transactionHash)
    const tr6 = await (await streamrConfig.revokeRole(await streamrConfig.ADMIN_ROLE(), myAddress, txOverrides)).wait()
    log("Revoked StreamrConfig.ADMIN_ROLE from %s (%s/tx/%s )", myAddress, blockExplorerUrl, tr6.transactionHash)

    const tr7 = await (await operatorFactory.grantRole(await operatorFactory.ADMIN_ROLE(), targetAddress, txOverrides)).wait()
    log("Granted OperatorFactory.ADMIN_ROLE to %s (%s/tx/%s )", targetAddress, blockExplorerUrl, tr7.transactionHash)
    const tr8 = await (await operatorFactory.revokeRole(await operatorFactory.ADMIN_ROLE(), myAddress, txOverrides)).wait()
    log("Revoked OperatorFactory.ADMIN_ROLE from %s (%s/tx/%s )", myAddress, blockExplorerUrl, tr8.transactionHash)

    const tr9 = await (await sponsorshipFactory.grantRole(await sponsorshipFactory.ADMIN_ROLE(), targetAddress, txOverrides)).wait()
    log("Granted SponsorshipFactory.ADMIN_ROLE to %s (%s/tx/%s )", targetAddress, blockExplorerUrl, tr9.transactionHash)
    const tr10 = await (await sponsorshipFactory.revokeRole(await sponsorshipFactory.ADMIN_ROLE(), myAddress, txOverrides)).wait()
    log("Revoked SponsorshipFactory.ADMIN_ROLE from %s (%s/tx/%s )", myAddress, blockExplorerUrl, tr10.transactionHash)
}

if (require.main === module) {
    main().catch(console.error)
}
