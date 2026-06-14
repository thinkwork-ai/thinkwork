output "raw_bucket_name" {
  value = aws_s3_bucket.lakehouse_raw.bucket
}

output "glue_database_name" {
  value = aws_glue_catalog_database.lakehouse.name
}
