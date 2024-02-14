// Steps before running this file:
//   start dev env: streamr-docker-dev start dev-chain-fast

import { Contract } from "@ethersproject/contracts"
import { Wallet } from "@ethersproject/wallet"
import { JsonRpcProvider } from "@ethersproject/providers"
import { keccak256 } from "@ethersproject/keccak256"
import { namehash } from "@ethersproject/hash"
import { toUtf8Bytes } from "@ethersproject/strings"

import { config } from "@streamr/config"

import type { ENS, FIFSRegistrar } from "../typechain"

import { abi as ensAbi } from "@ensdomains/ens-contracts/artifacts/contracts/registry/ENSRegistry.sol/ENSRegistry.json"
import { abi as fifsAbi } from "@ensdomains/ens-contracts/artifacts/contracts/registry/FIFSRegistrar.sol/FIFSRegistrar.json"

// import debug from "debug"
// const log = debug("log:streamr:ens-sync-script")
const { log } = console

const {
    ENS_NAME,

    KEY = "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0",
    CHAIN = "dev2",
    ETHEREUM_RPC,
    ENS_ADDRESS,
    ENS_REGISTRAR_ADDRESS,
    ENS_RESOLVER_ADDRESS,
} = process.env

const lastArg = process.argv[process.argv.length - 1]
const ensNameRaw = lastArg.endsWith(".ts") ? ENS_NAME : lastArg // ".ts" is this file, means no args given
if (!ensNameRaw) { throw new Error("Missing argument (or environment variable ENS_NAME)") }
const ensName = ensNameRaw.endsWith(".eth") ? ensNameRaw : ensNameRaw + ".eth"
const ensNameParts = ensName.split(".")
if (ensNameParts.length !== 2) { throw new Error("No subdomains allowed in ENS name: " + ensName) }

const rpcAddress = ETHEREUM_RPC ?? (config as any)[CHAIN]?.rpcEndpoints?.[0]?.url

const provider = new JsonRpcProvider(rpcAddress)
const wallet = new Wallet(KEY, provider)
log("Wallet address used for ENS registration: ", wallet.address)

const ensAddress = ENS_ADDRESS ?? (config as any)[CHAIN]?.contracts?.ENS
if (!ensAddress) { throw new Error("Either CHAIN (with ENS contract address) or ENS_ADDRESS must be set in environment") }
const ensContract = new Contract(ensAddress, ensAbi, wallet) as ENS

// "first-in-first-served registrar" in testing environment
const regAddress = ENS_REGISTRAR_ADDRESS ?? (config as any)[CHAIN]?.contracts?.FIFSRegistrar
if (!regAddress) { throw new Error("Either CHAIN (with FIFSRegistrar address) or ENS_REGISTRAR_ADDRESS must be set in environment") }
const ensRegistrarContract = new Contract(regAddress, fifsAbi, wallet) as FIFSRegistrar

const ensResolverAddress = ENS_RESOLVER_ADDRESS ?? (config as any)[CHAIN]?.contracts?.PublicResolver
if (!ensResolverAddress) { throw new Error("Either CHAIN (with PublicResolver address) or ENS_RESOLVER_ADDRESS must be set in environment") }

async function main() {
    log("registering ens name on mainnet: %s, owner %s", ensName, wallet.address)
    const hashedDomain = keccak256(toUtf8Bytes(ensNameParts[0]))
    const myEnsNamehash = namehash(ensName)
    let tx = await ensRegistrarContract.register(hashedDomain, wallet.address)
    await tx.wait()

    log("Setting owner (%s), resolver and ttl for ens", wallet.address)
    tx = await ensContract.setRecord(myEnsNamehash, wallet.address, ensResolverAddress, 1000000)
    await tx.wait()

    // TODO: subdomain support, maybe

    // const label = "subdomain"
    // randomENSNameWithSubdomain = label + "." + randomENSName
    // const nameHashedSubdomain = utils.namehash(randomENSNameWithSubdomain)
    // const labelhash = utils.keccak256(utils.toUtf8Bytes(label))
    // log("registering subdomain on mainnet:", randomENSNameWithSubdomain, " owner:", subdomainOwner.address)
    // tx = await fifsFromAdmin.register(utils.keccak256(utils.toUtf8Bytes(randomENSNameWithSubdomain)), subdomainOwner.address)
    // await tx.wait()

    // log("setting owner (" + subdomainOwner.address + "), resolver and ttl for subdomain")
    // tx = await ensFromAdmin.setSubnodeRecord(nameHashedENSName, labelhash, subdomainOwner.address, RESOLVERADDRESS, 1000000)
    // await tx.wait()

    // log('setting subnode owner for subdomain')
    // tx = await ensFromAdmin.setSubnodeOwner(nameHashedSubdomain, "subnodelabel1", walletMainnet.address, )
    // await tx.wait()

    // log('setting resolver for subdomain')
    // tx = await ensFromAdmin.setResolver(nameHashedSubdomain, RESOLVERADDRESS)
    // await tx.wait()

    log("Check: querying owner of %s (%s)", ensName, myEnsNamehash)
    log("    Got: %s", await ensContract.owner(myEnsNamehash))
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
