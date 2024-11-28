/* eslint-disable require-atomic-updates,max-len */
import { writeFileSync } from "fs"
import { upgrades, ethers as hardhatEthers } from "hardhat"
import { config } from "@streamr/config"
import { abi as ERC20ABI } from "../artifacts/@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol/IERC20Metadata.json"
import { abi as DATAv2ABI, bytecode as DATAv2Bytecode } from "./data/DATAv2.json" // TODO: grab DATAv2 from @streamr/data-v2 after it's in ethers v6
import {
    ENSCacheV2ABI,
    nodeRegistryABI,
    streamRegistryABI,
    streamStorageRegistryABI,
} from "../src/exports"

import type { Wallet } from "ethers"
import type {
    NodeRegistry, ENSCacheV2, StreamStorageRegistry,
    StreamRegistry,
} from "../src/exports"

import type {
    IERC20Metadata, IERC677,
} from "../typechain"

const { log } = console

const {
    provider, // specified in hardhat.config.ts
    getSigners, // specified in hardhat.config.ts, read from environment variable KEY
    Contract,
    ContractFactory,
    getContractFactory,
    utils: { formatEther, formatUnits },
    constants: { AddressZero },
} = hardhatEthers

export type StreamrBaseContracts = {
    token: IERC677,
    // trackerRegistry: NodeRegistry,
    streamRegistry: StreamRegistry,
    ENSCacheV2: ENSCacheV2,
    storageNodeRegistry: NodeRegistry,
    streamStorageRegistry: StreamStorageRegistry,
}

const {
    CHAIN,
    ENSCACHE_UPDATER_ADDRESS = "0xa3d1F77ACfF0060F7213D7BF3c7fEC78df847De1",
    OWNER,

    OUTPUT_FILE,

    IGNORE_BALANCE,
    IGNORE_TOKEN_SYMBOL, // set to bypass token check for testing
} = process.env
if (!CHAIN) {
    throw new Error("Must set CHAIN environment variable, e.g. CHAIN=dev2")
}

const {
    contracts: {
        DATA: DATA_TOKEN_ADDRESS,
        ENSCacheV2: ENSCACHE_ADDRESS,
        StreamRegistry: STREAM_REGISTRY_ADDRESS,
        StreamStorageRegistry: STREAM_STORAGE_REGISTRY_ADDRESS,
    },
    blockExplorerUrl = "https://polygonscan.com",
} = (config as any)[CHAIN]

async function main() {
    const [ deployer ] = await getSigners() as unknown as Wallet[] // specified in hardhat.config.ts
    if (!deployer) { throw new Error(`No deployer wallet specified for "${CHAIN}" in hardhat.config.ts`) }
    console.log("Connected to network %o", await provider.getNetwork())

    const gasRequired = 60000000 // measured in hardhat test network
    const gasPrice = await provider.getGasPrice()
    const estimatedGasCost = gasPrice.mul(gasRequired)
    log("Estimated gas cost: %s ETH (gas price %s gwei)", formatEther(estimatedGasCost), formatUnits(gasPrice, "gwei"))

    const balanceBefore = await provider.getBalance(deployer.address)
    log("Balance of %s: %s ETH", deployer.address, formatEther(balanceBefore))
    if (balanceBefore.lt(estimatedGasCost)) {
        if (!IGNORE_BALANCE) {
            throw new Error(
                `Insufficient native tokens for deployment in ${deployer.address} (${formatEther(balanceBefore)} < ${formatEther(estimatedGasCost)})`
            )
        }
    }

    const contracts: Partial<StreamrBaseContracts> = {}
    await deployBaseContracts(deployer, contracts).catch((e) => {
        log("Error deploying Streamr contracts: %o", e)
    })

    const balanceAfter = await provider.getBalance(deployer.address)
    const gasSpent = balanceBefore.sub(balanceAfter)
    log("Spent %s ETH for gas", formatEther(gasSpent))

    const addressesOutput = JSON.stringify(getAddresses(contracts), null, 4)
    if (OUTPUT_FILE) {
        writeFileSync(OUTPUT_FILE, addressesOutput)
        log("Wrote contract addresses to %s", OUTPUT_FILE)
    } else {
        log("All done! Streamr contract addresses:\n%s", JSON.stringify(getAddresses(contracts), null, 4))
    }
}

function getAddresses(contracts: Partial<StreamrBaseContracts>) {
    return {
        "DATA": contracts.token?.address,
        "StreamRegistry": contracts.streamRegistry?.address,
        "ENSCacheV2": contracts.ENSCacheV2?.address,
        "StorageNodeRegistry": contracts.storageNodeRegistry?.address,
        "StreamStorageRegistry": contracts.streamStorageRegistry?.address,
    }
}

export default async function deployBaseContracts(
    signer: Wallet,
    contracts: Partial<StreamrBaseContracts> = {}
): Promise<StreamrBaseContracts> {
    const { provider } = signer

    if (DATA_TOKEN_ADDRESS && await provider.getCode(DATA_TOKEN_ADDRESS) !== "0x") {
        const token = new Contract(DATA_TOKEN_ADDRESS, ERC20ABI, provider) as IERC20Metadata
        const tokenSymbol = await token.symbol()
            .catch(() => { throw "[call failed]" })
            .then((sym) => { if (!IGNORE_TOKEN_SYMBOL && sym !== "DATA") { throw sym } return sym })
            .catch((badSymbol: string) => { throw new Error(
                `Doesn't seem to be Streamr DATAv2 token: symbol="${badSymbol}" DATA=${DATA_TOKEN_ADDRESS}.
                If this is ok, bypass this check with IGNORE_TOKEN_SYMBOL=1.`
            ) })
        log("Found %s token at %s", tokenSymbol, token.address)
        contracts.token = token as unknown as IERC677
    } else {
        const tokenCF = new ContractFactory(DATAv2ABI, DATAv2Bytecode, signer)
        contracts.token = await tokenCF.deploy() as IERC677
        await contracts.token.deployed()
        log("Deployed DATAv2 token to %s", contracts.token.address)
    }

    if (STREAM_REGISTRY_ADDRESS && await provider.getCode(STREAM_REGISTRY_ADDRESS) !== "0x") {
        const registry = new Contract(STREAM_REGISTRY_ADDRESS, streamRegistryABI, signer) as StreamRegistry
        await registry.TRUSTED_ROLE().catch(() => { throw new Error(`Doesn't seem to be StreamRegistry: StreamRegistry=${STREAM_REGISTRY_ADDRESS}`) })
        log("Found StreamRegistry at %s", STREAM_REGISTRY_ADDRESS)
        contracts.streamRegistry = registry
    } else {
        const registryCF = await getContractFactory("StreamRegistryV5", { signer })
        contracts.streamRegistry = await upgrades.deployProxy(registryCF, [ AddressZero, AddressZero ], {
            kind: "uups", unsafeAllow: ["delegatecall"], timeout: 600000,
        }) as StreamRegistry
        await contracts.streamRegistry.deployed()
        log("Deployed StreamRegistry to %s", contracts.streamRegistry.address)
    }

    if (ENSCACHE_ADDRESS && await provider.getCode(ENSCACHE_ADDRESS) !== "0x") {
        const ensCacheV2 = new Contract(ENSCACHE_ADDRESS, ENSCacheV2ABI, provider) as ENSCacheV2
        await ensCacheV2.owner().catch(() => { throw new Error(`Doesn't seem to be ENSCacheV2: ${ENSCACHE_ADDRESS}`) })
        log("Found ENSCacheV2 at %s", ensCacheV2.address)
        contracts.ENSCacheV2 = ensCacheV2
    } else {
        const ensCacheV2Factory = await getContractFactory("ENSCacheV2Streamr", { signer })
        const ensCacheV2 = await upgrades.deployProxy(ensCacheV2Factory, [
            ENSCACHE_UPDATER_ADDRESS,
            contracts.streamRegistry.address,
            AddressZero, // ENSCacheV1
        ], {
            kind: "uups", unsafeAllow: ["delegatecall"], timeout: 600000,
        }) as ENSCacheV2
        log("ENSCacheV2 deployed at %s", ensCacheV2.address)
        contracts.ENSCacheV2 = ensCacheV2

        // Signer needs trusted role in order to set ENS cache
        const TRUSTED_ROLE = await contracts.streamRegistry.TRUSTED_ROLE()
        const grantRole1tx = await contracts.streamRegistry.grantRole(TRUSTED_ROLE, signer.address)
        log("Granting trusted role to self (%s): %s/tx/%s", signer.address, blockExplorerUrl, grantRole1tx.hash)
        await grantRole1tx.wait()

        const setEnsCacheTx = await contracts.streamRegistry.setEnsCache(ensCacheV2.address)
        log("Setting ENSCacheV2 on StreamRegistry: %s/tx/%s", blockExplorerUrl, setEnsCacheTx.hash)
        await setEnsCacheTx.wait()

        // ENSCacheV2 needs the trusted role in order to create stream when ENS fulfill comes
        const grantRole2tx = await contracts.streamRegistry.grantRole(TRUSTED_ROLE, ensCacheV2.address)
        log("Granting trusted role to ENSCacheV2: %s/tx/%s", blockExplorerUrl, grantRole2tx.hash)
        await grantRole2tx.wait()

        if (OWNER) {
            const grantRole3tx = await contracts.streamRegistry.grantRole(TRUSTED_ROLE, OWNER)
            log("Granting trusted role to OWNER (%s): %s/tx/%s", OWNER, blockExplorerUrl, grantRole3tx.hash)
            await grantRole3tx.wait()
        }
    }

    if (STREAM_STORAGE_REGISTRY_ADDRESS && await provider.getCode(STREAM_STORAGE_REGISTRY_ADDRESS) !== "0x") {
        const streamStorageRegistry = new Contract(STREAM_STORAGE_REGISTRY_ADDRESS, streamStorageRegistryABI, provider) as StreamStorageRegistry
        const nodeRegistryAddress = await streamStorageRegistry.nodeRegistry().catch(() => { throw new Error(`Doesn't seem to be StreamStorageRegistry: StreamStorageRegistry=${STREAM_STORAGE_REGISTRY_ADDRESS}`) })
        log("Found StreamStorageRegistry at %s", streamStorageRegistry.address)
        contracts.streamStorageRegistry = streamStorageRegistry

        const nodeRegistry = new Contract(nodeRegistryAddress, nodeRegistryABI, provider) as NodeRegistry
        await nodeRegistry.headNode().catch(() => { throw new Error(`Doesn't seem to be NodeRegistry: NodeRegistry=${nodeRegistryAddress}`) })
        log("Found NodeRegistry at %s", nodeRegistry.address)
        contracts.storageNodeRegistry = nodeRegistry
    } else {
        const nodeRegistryCF = await getContractFactory("NodeRegistry", { signer })
        const nodeRegistry = await upgrades.deployProxy(nodeRegistryCF, [
            OWNER ?? signer.address,
            false,
            [], // initial node addresses
            [], // initial node metadata
        ], {
            kind: "uups", unsafeAllow: ["delegatecall"], timeout: 600000,
        }) as NodeRegistry
        await nodeRegistry.deployed()
        log("Deployed NodeRegistry to %s", nodeRegistry.address)
        contracts.storageNodeRegistry = nodeRegistry

        const streamStorageRegistryCF = await getContractFactory("StreamStorageRegistryV2", { signer })
        contracts.streamStorageRegistry = await upgrades.deployProxy(streamStorageRegistryCF, [
            contracts.streamRegistry.address,
            contracts.storageNodeRegistry.address,
            AddressZero, // trusted forwarder
        ], {
            kind: "uups", unsafeAllow: ["delegatecall"], timeout: 600000,
        }) as StreamStorageRegistry
        await contracts.streamStorageRegistry.deployed()
        log("Deployed StreamStorageRegistry to %s", contracts.streamStorageRegistry.address)
    }

    return contracts as StreamrBaseContracts
}

if (require.main === module) {
    main().catch(console.error)
}
