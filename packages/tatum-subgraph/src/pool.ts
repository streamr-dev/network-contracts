import { log } from '@graphprotocol/graph-ts'

import { BrokerPool } from '../generated/schema'
import { InvestmentReceived } from '../generated/templates/BrokerPool/BrokerPool'

export function handleInvestmentReceived(event: InvestmentReceived): void {
    log.info('handleInvestmentReceived: sidechainaddress={} blockNumber={}', [event.address.toHexString(), event.block.number.toString()])
    let pool = BrokerPool.load(event.address.toHexString())
    pool!.investorCount = pool!.investorCount + 1
    pool!.save()
}
