use std::io::Write;
use std::path::Path;
use std::time::Duration;

use rusty_s3::{Bucket, Credentials, S3Action, UrlStyle};

use crate::settings::S3;

const SIGNED_FOR: Duration = Duration::from_secs(300);

pub struct S3Source {
    bucket: Bucket,
    credentials: Credentials,
    agent: ureq::Agent,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Fetched {
    Written(u64),
    Missing,
}

impl S3Source {
    /// A reader of one bucket with the credentials given.
    pub fn new(s: &S3) -> Result<S3Source, String> {
        let endpoint = url::Url::parse(&s.endpoint)
            .map_err(|e| format!("S3_ENDPOINT is not an address: {e}"))?;
        let style = if s.path_style {
            UrlStyle::Path
        } else {
            UrlStyle::VirtualHost
        };
        let bucket = Bucket::new(endpoint, style, s.bucket.clone(), s.region.clone())
            .map_err(|e| format!("S3_ENDPOINT and S3_BUCKET make no bucket address: {e:?}"))?;
        let agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .timeout_connect(Some(Duration::from_secs(10)))
            .timeout_global(Some(Duration::from_secs(600)))
            .build()
            .new_agent();
        Ok(S3Source {
            bucket,
            credentials: Credentials::new(s.access_key_id.clone(), s.secret_access_key.clone()),
            agent,
        })
    }

    /// Downloads one object into `to` with a signed GET, blocking; `Missing` when the bucket has no such object.
    pub fn fetch(&self, key: &str, to: &Path) -> Result<Fetched, String> {
        let url = self
            .bucket
            .get_object(Some(&self.credentials), key)
            .sign(SIGNED_FOR);
        let mut response = self
            .agent
            .get(url.as_str())
            .call()
            .map_err(|e| format!("could not reach the bucket: {e}"))?;
        match response.status().as_u16() {
            200 => {}
            404 => return Ok(Fetched::Missing),
            status => return Err(format!("the bucket answered {status}")),
        }
        let mut file = std::fs::File::create(to).map_err(|e| e.to_string())?;
        let written = std::io::copy(&mut response.body_mut().as_reader(), &mut file)
            .map_err(|e| format!("could not download the pack: {e}"))?;
        file.flush().map_err(|e| e.to_string())?;
        Ok(Fetched::Written(written))
    }
}
