import { config } from '@streamr/config'
import { Logger, TheGraphClient } from '@streamr/utils'
import  fetch  from 'node-fetch'
import { Sponsorship, sponsorshipABI } from '@streamr/network-contracts'
import { JsonRpcProvider } from '@ethersproject/providers'
import { Wallet } from '@ethersproject/wallet'
import { Contract } from '@ethersproject/contracts'
import { formatUnits, parseUnits } from '@ethersproject/units'
import { BigNumber, Overrides } from 'ethers'

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
if (!PRIVKEY) {
    throw new Error('Missing PRIVKEY')
}

const envConfig = (config as {[index: string]: any})[ENV]

const graphClient = new TheGraphClient({
    serverUrl: THEGRAPH_URL || envConfig.theGraphUrl,
    fetch,
    logger: new Logger(module)
})

const rpcUrl = ETHEREUM_RPC_URL || envConfig.rpcEndpoints[0].url
const provider = new JsonRpcProvider(rpcUrl)
const flagCloserWallet = new Wallet(PRIVKEY, provider)

const getGasPrice = async (): Promise<BigNumber> => {
    // https://wiki.polygon.technology/docs/tools/faucets/polygon-gas-station/
    // const gasPrice = await fetch('https://gasstation.polygon.technology/v2').then((response) => response.json())
    // return parseUnits((gasPrice.fast.maxFee).toString(), "gwei")

    const gasPrice = await provider.getGasPrice()
    console.log(`Got gas price: ${formatUnits(gasPrice, 'gwei')} gwei`)
    const newGasPrice: BigNumber = gasPrice.add(parseUnits('10', 'gwei'))
    console.log(`New gas price: ${formatUnits(newGasPrice, 'gwei')} gwei`)
    return newGasPrice
}

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
        const targetAddress = flag.target.id
        const sponsorshipAddress = flag.sponsorship.id
        const sponsorshipContract = new Contract(sponsorshipAddress, sponsorshipABI, flagCloserWallet) as unknown as Sponsorship
        // console.log('flag timestamp', flag.flaggingTimestamp, 'min flag age', minFlagStartTime)
        if (flag.flaggingTimestamp < minFlagStartTime) {
            try {
                const opts: Overrides = {
                    gasLimit: 1000000
                }
                if (ENV === 'polygon') {
                    opts.gasPrice = await getGasPrice()
                }
                console.log('flag id: %s | sending close flag tx, opts: %o', flagID, opts)
                const tx = await sponsorshipContract.voteOnFlag(
                    targetAddress,
                    "0x0000000000000000000000000000000000000000000000000000000000000000",
                    opts
                )
                console.log('flag id: %s | sent tx, tx hash: %s', flagID, tx.hash)
                const receipt = await tx.wait()
                console.log('flag id: %s | tx mined: %o', flagID, receipt.transactionHash)
            } catch (e) {
                console.log('flag id: %s | failed to send tx: %o', flagID, e)
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
