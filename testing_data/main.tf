provider "aws" {
  region = "us-west-2"
}

resource "aws_s3_bucket" "b" {
  bucket = "my-tf-test-bucket"
}

resource "aws_s3_bucket_acl" "example" {
  bucket = aws_s3_bucket.b.id
  acl    = "public-read"
}

# Add obvious misconfiguration: Hardcoded AWS credentials in provider
provider "aws" {
  alias = "bad"
  region = "us-east-1"
  access_key = "AKIAIOSFODNN7EXAMPLE"
  secret_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
}

# Add obvious misconfiguration: Security group open to the world
resource "aws_security_group" "allow_all" {
  name        = "allow_all"
  description = "Allow all inbound traffic"

  ingress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

