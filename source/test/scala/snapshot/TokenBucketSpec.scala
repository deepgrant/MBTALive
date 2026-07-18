package mbta.snapshot

import org.scalatest.funsuite.AnyFunSuite

final class TokenBucketSpec extends AnyFunSuite {
  test("the configured bucket never grants more than 800 permits in a rolling minute") {
    val policy = TokenBucketPolicy(safeLimit = 800, burstCapacity = 20)
    var state = TokenBucketState(policy.capacityMilli, lastRefillMs = 0L, blockedUntilEpoch = 0L)
    val grants = Vector.newBuilder[Long]

    (0L to 120000L).foreach { nowMs =>
      TokenBucket.acquire(state, policy, nowMs, nowMs / 1000L).foreach { next =>
        state = next
        grants += nowMs
      }
    }

    val times = grants.result()
    times.foreach { start =>
      assert(times.count(t => t >= start && t < start + 60000L) <= 800)
    }
  }

  test("a provider block prevents permits until reset") {
    val policy = TokenBucketPolicy(800, 20)
    val state = TokenBucketState(policy.capacityMilli, 0L, blockedUntilEpoch = 60L)
    assert(TokenBucket.acquire(state, policy, nowMs = 10000L, nowEpoch = 10L).isEmpty)
    assert(TokenBucket.acquire(state, policy, nowMs = 60000L, nowEpoch = 60L).nonEmpty)
  }

  test("a lower observed limit produces a lower refill rate") {
    val normal = TokenBucketPolicy(800, 20)
    val reduced = TokenBucketPolicy(80, 20)
    assert(reduced.refillMilliPerMs < normal.refillMilliPerMs)
    assert(reduced.capacityMilli <= normal.capacityMilli)
  }
}
