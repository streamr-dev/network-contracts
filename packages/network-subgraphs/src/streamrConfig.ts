import { BigInt, log } from '@graphprotocol/graph-ts'
import { ConfigChanged } from '../generated/StreamrConfig/StreamrConfig'
import { loadOrCreateNetwork } from './helpers'
import { Network } from '../generated/schema'

export function handleConfigChanged(event: ConfigChanged): void {
    let streamrConfigAddress = event.address.toHexString()
    let key = event.params.key.toString()
    let newValue = event.params.newValue
    let newAddress = event.params.newAddress.toHexString()

    log.info('handleConfigChanged: streamrConfigAddress={} key={} newValue={} newAddress={} blockNumber={}', 
        [streamrConfigAddress, key, newValue.toString(), newAddress, event.block.number.toString()])

    let network = loadOrCreateNetwork()
    if (key == "slashingFraction") {
        network.slashingFraction = newValue
        updateMinimumStake(network)
    }
    else if (key == "earlyLeaverPenaltyWei") { network.earlyLeaverPenaltyWei = newValue }
    else if (key == "minimumSelfDelegationFraction") { network.minimumSelfDelegationFraction = newValue }
    else if (key == "minimumDelegationWei") { network.minimumDelegationWei = newValue }
    else if (key == "maxPenaltyPeriodSeconds") { network.maxPenaltyPeriodSeconds = newValue.toI32() }
    else if (key == "maxQueueSeconds") { network.maxQueueSeconds = newValue.toI32() }
    else if (key == "maxAllowedEarningsFraction") { network.maxAllowedEarningsFraction = newValue }
    else if (key == "fishermanRewardFraction") { network.fishermanRewardFraction = newValue }
    else if (key == "protocolFeeFraction") { network.protocolFeeFraction = newValue }
    else if (key == "protocolFeeBeneficiary") { network.protocolFeeBeneficiary = newAddress }
    else if (key == "minEligibleVoterAge") { network.minEligibleVoterAge = newValue.toI32() }
    else if (key == "minEligibleVoterFractionOfAllStake") { network.minEligibleVoterFractionOfAllStake = newValue }
    else if (key == "flagReviewerCount") {
        network.flagReviewerCount = newValue.toI32()
        updateMinimumStake(network)
    }
    else if (key == "flagReviewerRewardWei") {
        network.flagReviewerRewardWei = newValue
        updateMinimumStake(network)
    }
    else if (key == "flaggerRewardWei") {
        network.flaggerRewardWei = newValue
        updateMinimumStake(network)
    }
    else if (key == "flagReviewerSelectionIterations") { network.flagReviewerSelectionIterations = newValue.toI32() }
    else if (key == "flagStakeWei") { network.flagStakeWei = newValue }
    else if (key == "reviewPeriodSeconds") { network.reviewPeriodSeconds = newValue.toI32() }
    else if (key == "votingPeriodSeconds") { network.votingPeriodSeconds = newValue.toI32() }
    else if (key == "flagProtectionSeconds") { network.flagProtectionSeconds = newValue.toI32() }
    else if (key == "randomOracle") { network.randomOracle = newAddress }
    else if (key == "trustedForwarder") { network.trustedForwarder = newAddress }
    else if (key == "sponsorshipFactory") { network.sponsorshipFactory = newAddress }
    else if (key == "operatorFactory") { network.operatorFactory = newAddress }
    else if (key == "voterRegistry") { network.voterRegistry = newAddress }
    else if (key == "operatorContractOnlyJoinPolicy") { network.operatorContractOnlyJoinPolicy = newAddress }
    else if (key == "streamRegistryAddress") { network.streamRegistryAddress = newAddress }
    else { log.error("handleConfigChanged: unknown key={}", [key]) }
    network.save()
}

function updateMinimumStake(network: Network): void {
    network.minimumStakeWei = 
        (network.flaggerRewardWei.plus(BigInt.fromI32(network.flagReviewerCount).times(network.flagReviewerRewardWei))).div(network.slashingFraction)
}
