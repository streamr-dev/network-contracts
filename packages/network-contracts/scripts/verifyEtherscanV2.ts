#!/usr/bin/env npx ts-node

/**
 * Verify a deployed contract's source code using the Etherscan API v2 (https://docs.etherscan.io/v2-migration).
 *
 * Why not `npm run verify` (hardhat verify)? The @nomiclabs/hardhat-etherscan plugin used in this repo targets the
 *   per-chain v1 APIs (api.polygonscan.com etc.), which Etherscan has retired. The hardhat-verify versions with v2 support
 *   require a newer Hardhat than this repo uses. This script does the same thing using the build-info that `hardhat compile` produces.
 *
 * The source code is taken from the hardhat build-info of the given contract, so run `npm run build` first (so that the
 *   artifacts match what was deployed), and don't change the contracts in between.
 *
 * Environment variables:
 *   CHAIN             network name from @streamr/config, e.g. polygon (used for chainId and block explorer URL)
 *   ADDRESS           address of the deployed contract
 *   CONTRACT          fully qualified contract name, e.g. contracts/OperatorTokenomics/Sponsorship.sol:Sponsorship
 *   ETHERSCAN_KEY     Etherscan API key (one key works for all chains in API v2)
 *   CONSTRUCTOR_ARGS  optional, ABI-encoded constructor arguments as hex (default: none)
 *   ETHERSCAN_API_URL optional, default https://api.etherscan.io/v2/api
 */

import { existsSync, readFileSync } from "fs"
import { dirname, join, resolve } from "path"
import fetch from "node-fetch"
import { JsonRpcProvider } from "@ethersproject/providers"
import { config } from "@streamr/config"

const { log } = console

const {
    CHAIN,
    ADDRESS,
    CONTRACT,
    ETHERSCAN_KEY,
    CONSTRUCTOR_ARGS = "",
    ETHERSCAN_API_URL = "https://api.etherscan.io/v2/api",
    ETHEREUM_RPC,
} = process.env
if (!CHAIN) { throw new Error("Must set CHAIN environment variable, e.g. CHAIN=polygon") }
if (!ADDRESS) { throw new Error("Must set ADDRESS environment variable to the deployed contract's address") }
if (!CONTRACT || !CONTRACT.includes(":")) {
    throw new Error("Must set CONTRACT environment variable to fully qualified name, " +
        "e.g. CONTRACT=contracts/OperatorTokenomics/Sponsorship.sol:Sponsorship")
}
if (!ETHERSCAN_KEY) { throw new Error("Must set ETHERSCAN_KEY environment variable") }

const {
    id: chainId,
    rpcEndpoints: [{ url: ethereumRpcUrlFromConfig }],
    blockExplorerUrl = "",
} = (config as any)[CHAIN]
if (!chainId) { throw new Error(`No chain id found in @streamr/config for CHAIN=${CHAIN}`) }

const [sourceName, contractName] = CONTRACT.split(":")
const artifactsDir = resolve(__dirname, "..", "artifacts")

type BuildInfo = {
    solcVersion: string
    solcLongVersion: string
    input: { language: string, sources: Record<string, { content: string }>, settings: any }
    output: { sources: Record<string, { ast: { nodes: Array<{ nodeType: string, absolutePath?: string }> } }> }
}

function loadBuildInfo(): BuildInfo {
    const dbgPath = join(artifactsDir, sourceName, `${contractName}.dbg.json`)
    if (!existsSync(dbgPath)) { throw new Error(`Artifact debug file not found: ${dbgPath}. Run 'npm run build' first.`) }
    const { buildInfo } = JSON.parse(readFileSync(dbgPath, "utf8"))
    return JSON.parse(readFileSync(resolve(dirname(dbgPath), buildInfo), "utf8"))
}

/** Only include the sources that the contract (transitively) imports, instead of the whole compilation job */
function minimalStandardJsonInput(buildInfo: BuildInfo): string {
    const included = new Set<string>()
    const queue = [sourceName]
    while (queue.length > 0) {
        const name = queue.shift()!
        if (included.has(name)) { continue }
        included.add(name)
        const ast = buildInfo.output.sources[name]?.ast
        if (!ast) { throw new Error(`Source ${name} not found in build-info output`) }
        for (const node of ast.nodes) {
            if (node.nodeType === "ImportDirective" && node.absolutePath) {
                queue.push(node.absolutePath)
            }
        }
    }
    const sources: Record<string, { content: string }> = {}
    for (const name of Object.keys(buildInfo.input.sources)) {
        if (included.has(name)) { sources[name] = buildInfo.input.sources[name] }
    }
    log("Including %d of %d sources from build-info", included.size, Object.keys(buildInfo.input.sources).length)
    return JSON.stringify({ language: buildInfo.input.language, sources, settings: buildInfo.input.settings })
}

type EtherscanResponse = { status: string, message: string, result: any }
async function etherscanRequest(params: Record<string, string>, method: "GET" | "POST" = "GET"): Promise<EtherscanResponse> {
    const url = new URL(ETHERSCAN_API_URL)
    url.searchParams.set("chainid", String(chainId))
    const body = new URLSearchParams({ apikey: ETHERSCAN_KEY!, ...params })
    const response = method === "GET"
        ? await fetch(`${url.toString()}&${body.toString()}`)
        : await fetch(url.toString(), { method, body, headers: { "Content-Type": "application/x-www-form-urlencoded" } })
    const text = await response.text()
    try {
        return JSON.parse(text)
    } catch (e) {
        throw new Error(`Non-JSON response from ${url.host} (HTTP ${response.status}): ${text.slice(0, 300)}`)
    }
}

async function isAlreadyVerified(): Promise<boolean> {
    const { status, result } = await etherscanRequest({ module: "contract", action: "getsourcecode", address: ADDRESS! })
    return status === "1" && Array.isArray(result) && result[0]?.SourceCode !== ""
}

async function checkDeployedBytecode(buildInfo: BuildInfo) {
    const provider = new JsonRpcProvider(ETHEREUM_RPC ?? ethereumRpcUrlFromConfig)
    const onChain = await provider.getCode(ADDRESS!)
    if (onChain === "0x") { throw new Error(`No contract at ${ADDRESS} on ${CHAIN}`) }
    const artifactPath = join(artifactsDir, sourceName, `${contractName}.json`)
    const { deployedBytecode } = JSON.parse(readFileSync(artifactPath, "utf8"))
    if (onChain.length !== deployedBytecode.length) {
        throw new Error(`Deployed bytecode length (${onChain.length}) differs from artifact (${deployedBytecode.length}): ` +
            `is ${CONTRACT} the right contract, and are the artifacts up to date?`)
    }
    // immutables (e.g. ERC2771Context's trusted forwarder) are zero placeholders in the artifact, so an inexact match can be legitimate
    log("On-chain bytecode %s artifact deployedBytecode (compiler %s)",
        onChain.toLowerCase() === deployedBytecode.toLowerCase() ? "matches" : "has same length as", buildInfo.solcLongVersion)
}

async function main() {
    log("Verifying %s at %s on %s (chainId %s) via %s", CONTRACT, ADDRESS, CHAIN, chainId, ETHERSCAN_API_URL)
    const buildInfo = loadBuildInfo()
    await checkDeployedBytecode(buildInfo)

    if (await isAlreadyVerified()) {
        log("Already verified: %s/address/%s#code", blockExplorerUrl, ADDRESS)
        return
    }

    const submission = await etherscanRequest({
        module: "contract",
        action: "verifysourcecode",
        contractaddress: ADDRESS!,
        sourceCode: minimalStandardJsonInput(buildInfo),
        codeformat: "solidity-standard-json-input",
        contractname: CONTRACT!,
        compilerversion: `v${buildInfo.solcLongVersion}`,
        constructorArguements: CONSTRUCTOR_ARGS.replace(/^0x/, ""), // sic, Etherscan's spelling
    }, "POST")
    if (submission.status !== "1") {
        throw new Error(`Verification submission failed: ${submission.message} / ${submission.result}`)
    }
    const guid = submission.result
    log("Submitted, guid %s. Waiting for Etherscan to process...", guid)

    for (let attempt = 0; attempt < 30; attempt++) {
        await sleep(5000)
        const { result } = await etherscanRequest({ module: "contract", action: "checkverifystatus", guid })
        log("    %s", result)
        if (result === "Pass - Verified" || result === "Already Verified") {
            log("Verified: %s/address/%s#code", blockExplorerUrl, ADDRESS)
            return
        }
        if (typeof result !== "string" || !result.startsWith("Pending")) {
            throw new Error(`Verification failed: ${result}`)
        }
    }
    throw new Error(`Verification still pending after timeout, check manually: ${blockExplorerUrl}/address/${ADDRESS}#code (guid ${guid})`)
}

async function sleep(ms: number) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms)
    })
}

if (require.main === module) {
    main().catch((e) => {
        console.error(e)
        process.exit(1)
    })
}
