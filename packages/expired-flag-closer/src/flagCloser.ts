import { config } from '@streamr/config'
import { Logger, TheGraphClient } from '@streamr/utils'
import  fetch  from 'node-fetch'
import { Sponsorship, sponsorshipABI } from '@streamr/network-contracts'
import { JsonRpcProvider } from '@ethersproject/providers'
import { Wallet } from '@ethersproject/wallet'
import { Contract } from '@ethersproject/contracts'
import { randomBytes } from '@ethersproject/random'

const {
    ENV,
    ETHEREUM_RPC_URL,
    THEGRAPH_URL,
    PRIVKEY,
    INTERVALSEC
} = process.env

const flagLifetimeSeconds = 60 * 75 // 75 minutes

if (!ENV || !(config as {[index: string]: any})[ENV]) {
    throw new Error(`Unknown ENV: ${ENV}`)
}

const envConfig = (config as {[index: string]: any})[ENV]

const graphClient = new TheGraphClient({
    serverUrl: THEGRAPH_URL || envConfig.theGraphUrl,
    fetch,
    logger: new Logger(module)
})
const rpcUrl = ETHEREUM_RPC_URL || envConfig.rpcEndpoints[0].url
const provider = new JsonRpcProvider(rpcUrl)
const signer = new Wallet(PRIVKEY || "", provider).connect(provider)

async function checkForFlags() {
    console.log('checking, flag lifetime is %d seconds', flagLifetimeSeconds)
    const minFlagStartTime = Math.floor(Date.now() / 1000) - flagLifetimeSeconds
    // console.log('min flag start time', minFlagStartTime)
    // const minFlagStartTime = Math.floor(Date.now() / 1000)
    let flags: any
    try {
        flags = await graphClient.queryEntity<any>({ query: `
        {
            flags(where: {flaggingTimestamp_lt: ${minFlagStartTime}, result_not_in: ["kicked", "failed"]}) {
                id
                flaggingTimestamp
                sponsorship {
                    id
                }
                target {
                    id
                }
            }
        }
        `})
    } catch (e) {
        console.log('failed to query flags', e)
        return
    }
    console.log('found', flags.flags.length, 'flags')
    for (const flag of flags.flags) {
        // console.log('flag', flag)
        const flagID = flag.id
        const operatorAddress = flag.target.id
        const sponsorship = flag.sponsorship.id
        const sponsorshipContract = new Contract(sponsorship, sponsorshipABI, signer) as unknown as Sponsorship
        // console.log('flag timestamp', flag.flaggingTimestamp, 'min flag age', minFlagStartTime)
        if (flag.flaggingTimestamp < minFlagStartTime) {
            try {
                console.log('flag id:', flagID, 'sending close flag tx')
                const tx = await sponsorshipContract.voteOnFlag(operatorAddress, randomBytes(32))
                console.log('flag id:', flagID, 'sent tx, tx hash: ', tx.hash)
                const receipt = await tx.wait()
                console.log('flag id:', flagID, 'tx mined', receipt.transactionHash)
            } catch (e) {
                console.log('flag id:', flagID, 'failed to send tx', e)
            }
        }
    }
}

async function main() {
    console.log('Connected to %s, %o', rpcUrl, await provider.getNetwork())
    await checkForFlags()
    setInterval(checkForFlags, parseInt(INTERVALSEC || "900") * 1000) // default 15 minutes
}

main().catch(console.error)
