package mbta.snapshot

final case class TokenBucketPolicy(safeLimit: Int, burstCapacity: Int) {
  val effectiveBurst: Int = math.min(burstCapacity, math.max(1, safeLimit / 10))
  val capacityMilli: Long = effectiveBurst.toLong * 1000L
  val refillMilliPerMs: Long = math.max(0, (safeLimit - effectiveBurst) / 60).toLong
}

final case class TokenBucketState(tokensMilli: Long, lastRefillMs: Long, blockedUntilEpoch: Long)

object TokenBucket {
  def acquire(
    state: TokenBucketState,
    policy: TokenBucketPolicy,
    nowMs: Long,
    nowEpoch: Long,
  ): Option[TokenBucketState] = {
    val elapsed = math.max(0L, nowMs - state.lastRefillMs)
    val available = math.min(policy.capacityMilli, state.tokensMilli + elapsed * policy.refillMilliPerMs)
    if (state.blockedUntilEpoch > nowEpoch || available < 1000L) None
    else Some(TokenBucketState(available - 1000L, nowMs, state.blockedUntilEpoch))
  }
}
