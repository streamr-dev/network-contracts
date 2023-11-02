import { config } from '@streamr/config'
import { Logger, TheGraphClient } from '@streamr/utils'
import fetch from 'node-fetch'
import { Contract, ethers } from 'ethers'
import { Sponsorship, sponsorshipABI } from '@streamr/network-contracts'

const { ENV, PRIVKEY } = process.env

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

async function main() {
    console.log('starting, flag lifetime is', flagLifetime, 'seconds')
    // const maxFlagAge = Math.floor(Date.now() / 1000) - flagLifetime
    const minFlagAge = Math.floor(Date.now() / 1000) - 60
    const flags = await graphClient.queryEntity<any>({ query: `
        {
            flags(where: {flaggingTimestamp_lt: ${minFlagAge}}) {
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
    console.log(flags)
    for (const flag of flags.flags) {
        console.log('flag', flag)
        console.log('flag age now is', Math.floor(Date.now() / 1000) - flag.flaggingTimestamp)
        const flagId = flag.id
        const operatorAddress = flag.target.id
        const sponsorship = flag.sponsorship.id
        const sponsorshipContract = new Contract(sponsorship, sponsorshipABI, signer) as unknown as Sponsorship
        if (flag.flaggingTimestamp > minFlagAge) {
            // endFlag(flagId, sponsorshipContract, operatorAddress)
        }
    }
}
main()

const endFlag = async (flagID: string, sponsorshipContract: Sponsorship, operatorAddress: string) => {

    const tx = await sponsorshipContract.voteOnFlag(operatorAddress, "0x1")
    console.log('flag id: ', flagID, 'sent tx, tx hash: ', tx.hash)
    const receipt = await tx.wait()
    console.log('flag id:', flagID, 'tx mined', receipt.transactionHash)
}
