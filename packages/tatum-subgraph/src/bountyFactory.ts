import { BigInt, log } from '@graphprotocol/graph-ts'

import { NewBounty } from '../generated/BountyFactory/BountyFactory'
import { Bounty } from '../generated/schema'
import { Bounty as BountyTemplate } from '../generated/templates'

export function handleBountyCreated(event: NewBounty): void {
    log.info('handleBountyCreated: sidechainaddress={} blockNumber={}', [event.params.bountyContract.toHexString(), event.block.number.toString()])
    
    let bounty = new Bounty(event.params.bountyContract.toHexString())
    bounty.totalStakedWei = BigInt.fromI32(0)
    bounty.unallocatedWei = BigInt.fromI32(0)
    bounty.projectedInsolvency = BigInt.fromI32(0)
    bounty.brokerCount = 0
    bounty.isRunning = false
    bounty.save()
    
    // Instantiate template
    log.info('handleBountyCreated2 at {}', [event.params.bountyContract.toHexString()])
    BountyTemplate.create(event.params.bountyContract)
    // BountyTemplate.create(event.params.bountyContract)
}
