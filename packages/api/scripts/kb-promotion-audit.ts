// CloudWatch Logs Insights query helper for Brain v0 inert KB promotion logs.

console.log(`
fields @timestamp, @message
| filter @message like /kb_promotion_inert_decision/
| stats
    count_if(@message like /kb_would_promote/) as would_promote,
    count_if(@message like /kb_would_skip/) as would_skip
  by bin(1d)
`);
