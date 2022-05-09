import { log } from '@graphprotocol/graph-ts'

import { NewBounty } from '../generated/BountyFactory/BountyFactory'
import { Bounty } from '../generated/schema'
import { Bounty as Bounty2 } from '../generated/templates'

export function handleBountyCreated(event: NewBounty): void {
    log.info('handleDUCreated: sidechainaddress={} blockNumber={}', [event.params.bountyContract.toHexString(), event.block.number.toString()])

    let bounty = new Bounty(event.params.bountyContract.toHexString())
    bounty.save()

    // Instantiate template
    Bounty2.create(event.params.bountyContract)
}
