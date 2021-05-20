import { waffle } from 'hardhat'
import { use } from 'chai'
import { BigNumber } from 'ethers'

import LinkTokenJson from '../artifacts/@chainlink/token/contracts/v0.6/LinkToken.sol/LinkToken.json'
import { LinkToken } from '../typechain/LinkToken'
import OracleJson from '../artifacts/@chainlink/contracts/src/v0.6/Oracle.sol/Oracle.json'
import { Oracle } from '../typechain/Oracle'
import ENSCacheJson from '../artifacts/contracts/chainlinkClient/ENSCache.sol/ENSCache.json'
import { ENSCache } from '../typechain/ENSCache'

const { deployContract } = waffle
const { provider } = waffle

use(waffle.solidity)

describe('StreamRegistry', (): void => {
    const wallets = provider.getWallets()
    let ensCacheFromAdmin: ENSCache
    let linkTokenFromAdmin: LinkToken
    let oracleFromAdmin: Oracle
    const adminAdress: string = wallets[0].address

    before(async (): Promise<void> => {
        linkTokenFromAdmin = await deployContract(wallets[0], LinkTokenJson) as LinkToken
        oracleFromAdmin = await deployContract(wallets[0], OracleJson, [linkTokenFromAdmin.address]) as Oracle
        await oracleFromAdmin.setFulfillmentPermission(adminAdress, true)

        ensCacheFromAdmin = await deployContract(wallets[0], ENSCacheJson,
            [adminAdress, 'jobid']) as ENSCache
        await ensCacheFromAdmin.setChainlinkTokenAddress(linkTokenFromAdmin.address)

        await linkTokenFromAdmin.transfer(ensCacheFromAdmin.address,
            BigNumber.from('1000000000000000000000')) // 1000 link
    })

    it('positivetest queryENSOwner', async (): Promise<void> => {
        await ensCacheFromAdmin.requestENSOwner('ensdomain1')
    })
})
