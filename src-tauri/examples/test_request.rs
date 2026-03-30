#[tokio::main]
async fn main() {
    // 最精简的 client，禁掉一切可能的差异
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .no_proxy()
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .no_zstd()
        .user_agent("curl/8.7.1")
        .build()
        .unwrap();

    let params = [
        ("prompt", "A beast making a speech"),
        ("image_url", "https://chatbot-images-eigenai.s3.amazonaws.com/tiv2v/images/1765375259456_9d6ro51kmu.jpeg"),
        ("infer_steps", "5"),
        ("seed", "42"),
    ];

    let start = std::time::Instant::now();
    match client
        .post("http://127.0.0.1:8000/api/wan2p2-i2v-14b-turbo")
        .header("Authorization", "Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb")
        .header("Accept", "*/*")
        .header("X-Metrics-Debug", "true")
        .form(&params)
        .send()
        .await
    {
        Ok(resp) => {
            let s = resp.status();
            let body = resp.text().await.unwrap_or_default();
            println!("[minimal] status={s} time={:.3}s body={}", start.elapsed().as_secs_f64(), &body[..body.len().min(300)]);
        }
        Err(e) => println!("[minimal] error: {e} time={:.3}s", start.elapsed().as_secs_f64()),
    }
}
