import { log } from '@graphprotocol/graph-ts'
import { Staking, Unstaking } from '../generated/schema'
import {
    Stake,
    Unstake,
} from '../generated/ProjectStakingV1/ProjectStakingV1'
import { loadOrCreateProject } from './helpers'

export function handleStake(event: Stake): void {
    const projectId = event.params.projectId.toHexString()
    const user = event.params.user.toHexString()
    const amount = event.params.amount.toHexString()
    log.info('handleStake: projectId={} user={} amount={} blockNumber={}',
        [projectId, user, amount, event.block.number.toString()])
        
    const project = loadOrCreateProject(event.params.projectId)

    const newStakeUnstakeCount = project.stakeUnstakeCount + 1
    const stakeId = projectId + '-' + user + '-' + newStakeUnstakeCount.toString()
    log.info('handleStake: stakeId={}', [stakeId])

    const staking = new Staking(stakeId)
    staking.project = projectId
    staking.user = event.params.user
    staking.amount = event.params.amount
    staking.stakedAt = event.block.timestamp
    project.stakeUnstakeCount = newStakeUnstakeCount
    project.save()
    staking.save()
}

export function handleUnstake(event: Unstake): void {
    const projectId = event.params.projectId.toHexString()
    const user = event.params.user.toHexString()
    const amount = event.params.amount.toHexString()
    log.info('handleUnstake: projectId={} user={} amount={} blockNumber={}',
        [projectId, user, amount, event.block.number.toString()])
        
    const project = loadOrCreateProject(event.params.projectId)

    const newStakeUnstakeCount = project.stakeUnstakeCount + 1
    const unstakeId = projectId + '-' + user + '-' + newStakeUnstakeCount.toString()
    log.info('handleUnstake: unstakeId={}', [unstakeId])

    const unstaking = new Unstaking(unstakeId)
    unstaking.project = projectId
    unstaking.user = event.params.user
    unstaking.amount = event.params.amount
    unstaking.unstakedAt = event.block.timestamp
    project.stakeUnstakeCount = newStakeUnstakeCount
    project.save()
    unstaking.save()
}
