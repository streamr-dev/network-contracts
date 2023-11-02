import { config } from '@streamr/config'
import { Logger, TheGraphClient } from '@streamr/utils'
import fetch from 'node-fetch'
import { Contract, ethers } from 'ethers'
import { Sponsorship, sponsorshipABI } from '@streamr/network-contracts'

const { ENV, PRIVKEY, INTERVALSEC } = process.env

let graphClient: TheGraphClient
let provider: ethers.providers.JsonRpcProvider
let signer: ethers.Signer
const flagLifetime = 60 * 75 // 75 minutes

if (ENV === 'test') {
    graphClient = new TheGraphClient({
        serverUrl: config.dev2.theGraphUrl,
        fetch,
        logger: new Logger(module)
    })
    provider = new ethers.providers.JsonRpcProvider(config.dev2.rpcEndpoints[0].url)
    signer = new ethers.Wallet("0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0")
        .connect(provider)
} else {
    graphClient = new TheGraphClient({
        serverUrl: config.mumbai.theGraphUrl,
        fetch,
        logger: new Logger(module)
    })
    provider = new ethers.providers.JsonRpcProvider(config.mumbai.rpcEndpoints[0].url)
    signer = new ethers.Wallet(PRIVKEY || "", provider).connect(provider)
}

async function checkForFlags() {
    console.log('checking, flag lifetime is', flagLifetime, 'seconds')
    const minFlagStartTime = Math.floor(Date.now() / 1000) - flagLifetime
    // console.log('min flag start time', minFlagStartTime)
    // const minFlagStartTime = Math.floor(Date.now() / 1000)
    const flags = await graphClient.queryEntity<any>({ query: `
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
    console.log('found', flags.flags.length, 'flags')
    for (const flag of flags.flags) {
        // console.log('flag', flag)
        const flagId = flag.id
        const operatorAddress = flag.target.id
        const sponsorship = flag.sponsorship.id
        const sponsorshipContract = new Contract(sponsorship, sponsorshipABI, signer) as unknown as Sponsorship
        // console.log('flag timestamp', flag.flaggingTimestamp, 'min flag age', minFlagStartTime)
        if (flag.flaggingTimestamp < minFlagStartTime) {
            await endFlag(flagId, sponsorshipContract, operatorAddress)
        }
    }
}

async function main() {
    await checkForFlags()
    setInterval(checkForFlags, parseInt(INTERVALSEC || "900") * 1000) // default 15 minutes
}

main()

const endFlag = async (flagID: string, sponsorshipContract: Sponsorship, operatorAddress: string) => {
    try {
        console.log('flag id:', flagID, 'sending close flag tx')
        const tx = await sponsorshipContract.voteOnFlag(operatorAddress, ethers.utils.randomBytes(32))
        console.log('flag id:', flagID, 'sent tx, tx hash: ', tx.hash)
        const receipt = await tx.wait()
        console.log('flag id:', flagID, 'tx mined', receipt.transactionHash)
    } catch (e) {
        console.log('flag id:', flagID, 'failed to send tx', e)
    }
}
