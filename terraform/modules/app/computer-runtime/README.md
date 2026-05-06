# Computer Runtime

Shared ECS/EFS substrate for ThinkWork Computers.

This module creates shared infrastructure only:

- ECR repository for the Computer runtime image.
- ECS/Fargate cluster.
- Encrypted EFS filesystem and mount targets.
- Task and EFS security groups, with NFS scoped to runtime tasks.
- Execution/task roles and CloudWatch log group.
- Manager IAM policy for per-Computer access points, task definitions, and services.

Per-Computer EFS access points, task-definition revisions, and ECS services are created by the Computer manager Lambda from database rows. Terraform should not create one resource set per user.
