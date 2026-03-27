-- 导入 E2E 测试用例到 QAI
-- 基础 URL: https://train-backend-test.eigenai.com
-- 默认 Authorization: Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb

-- ======= 集合 =======
INSERT OR IGNORE INTO collections (id, name, description) VALUES
('col-text', 'Text Models', 'LLM 文本模型 E2E 测试'),
('col-audio', 'Audio Models', '音频模型 E2E 测试 (TTS/ASR)'),
('col-image', 'Image Models', '图像模型 E2E 测试'),
('col-video', 'Video Models', '视频模型 E2E 测试');

-- ======= TEXT 文件夹 =======
INSERT OR IGNORE INTO folders (id, collection_id, parent_folder_id, name, sort_order, is_chain) VALUES
('f-llama31', 'col-text', NULL, 'Llama 3.1 8B', 1, 0),
('f-deepseek', 'col-text', NULL, 'DeepSeek V3.1', 2, 0),
('f-qwen3-8b', 'col-text', NULL, 'Qwen3 8B', 3, 0),
('f-glm5', 'col-text', NULL, 'GLM-5', 4, 0);

-- ======= AUDIO 文件夹 =======
INSERT OR IGNORE INTO folders (id, collection_id, parent_folder_id, name, sort_order, is_chain) VALUES
('f-higgs-tts', 'col-audio', NULL, 'Higgs Audio V2.5 (TTS)', 1, 0),
('f-higgs-tts-chain', 'col-audio', NULL, 'Higgs TTS 自定义音色', 2, 1),
('f-whisper', 'col-audio', NULL, 'Whisper V3 Turbo (ASR)', 3, 0);

-- ======= IMAGE 文件夹 =======
INSERT OR IGNORE INTO folders (id, collection_id, parent_folder_id, name, sort_order, is_chain) VALUES
('f-eigen-img', 'col-image', NULL, 'Eigen Image', 1, 0);

-- ======= VIDEO 文件夹 =======
INSERT OR IGNORE INTO folders (id, collection_id, parent_folder_id, name, sort_order, is_chain) VALUES
('f-wan-i2v', 'col-video', NULL, 'Wan2.2 I2V 14B Turbo', 1, 0),
('f-wan-i2v-chain', 'col-video', NULL, 'Wan2.2 Playground 完整流程', 2, 1);

-- ======= Llama 3.1 8B 请求 =======
INSERT OR IGNORE INTO requests (id, collection_id, folder_id, name, method, url, headers, query_params, body_type, body_content, sort_order, extract_rules) VALUES
('r-llama-health', 'col-text', 'f-llama31', '健康检查 (非流式)', 'POST',
 'https://train-backend-test.eigenai.com/api/v1/chat/completions',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true},{"key":"X-Metrics-Debug","value":"true","enabled":true}]',
 '[]', 'json',
 '{"model":"llama31-8b","messages":[{"role":"user","content":"Health check. Please return ok."}],"max_tokens":50,"stream":false}',
 1, '[]'),

('r-llama-stream', 'col-text', 'f-llama31', '健康检查 (流式)', 'POST',
 'https://train-backend-test.eigenai.com/api/v1/chat/completions',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true},{"key":"X-Metrics-Debug","value":"true","enabled":true}]',
 '[]', 'json',
 '{"model":"llama31-8b","messages":[{"role":"user","content":"Health check. Please return ok."}],"max_tokens":50,"stream":true}',
 2, '[]'),

('r-llama-system', 'col-text', 'f-llama31', '带系统提示词', 'POST',
 'https://train-backend-test.eigenai.com/api/v1/chat/completions',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true}]',
 '[]', 'json',
 '{"model":"llama31-8b","messages":[{"role":"system","content":"You are a helpful assistant."},{"role":"user","content":"Say hello in one word"}],"max_tokens":50,"stream":false}',
 3, '[]'),

('r-llama-temp0', 'col-text', 'f-llama31', '温度为0 (确定性输出)', 'POST',
 'https://train-backend-test.eigenai.com/api/v1/chat/completions',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true}]',
 '[]', 'json',
 '{"model":"llama31-8b","messages":[{"role":"user","content":"What is 1+1? Answer with just the number."}],"max_tokens":10,"temperature":0.0,"stream":false}',
 4, '[]'),

('r-llama-poem', 'col-text', 'f-llama31', '长输出流式 (验证TPS)', 'POST',
 'https://train-backend-test.eigenai.com/api/v1/chat/completions',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true}]',
 '[]', 'json',
 '{"model":"llama31-8b","messages":[{"role":"user","content":"Write a short poem about the sea"}],"max_tokens":200,"stream":true}',
 5, '[]'),

('r-llama-usage', 'col-text', 'f-llama31', '流式+usage统计', 'POST',
 'https://train-backend-test.eigenai.com/api/v1/chat/completions',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true}]',
 '[]', 'json',
 '{"model":"llama31-8b","messages":[{"role":"system","content":"You are a helpful assistant."},{"role":"user","content":"Health check. Please return ok."}],"max_tokens":911,"temperature":0.7,"stream":true,"stream_options":{"include_usage":true}}',
 6, '[]'),

('r-llama-playground', 'col-text', 'f-llama31', 'Playground 路由', 'POST',
 'https://train-backend-test.eigenai.com/api/llama31-8b',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true}]',
 '[]', 'json',
 '{"model":"llama31-8b","messages":[{"role":"user","content":"Health check. Please return ok."}],"max_tokens":50,"stream":true}',
 7, '[]'),

('r-llama-err-empty', 'col-text', 'f-llama31', '错误: 空消息列表 (400)', 'POST',
 'https://train-backend-test.eigenai.com/api/v1/chat/completions',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true}]',
 '[]', 'json',
 '{"model":"llama31-8b","messages":[]}',
 8, '[]'),

('r-llama-err-missing', 'col-text', 'f-llama31', '错误: 缺少messages (400)', 'POST',
 'https://train-backend-test.eigenai.com/api/v1/chat/completions',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true}]',
 '[]', 'json',
 '{"model":"llama31-8b","max_tokens":50}',
 9, '[]');

-- ======= DeepSeek V3.1 请求 =======
INSERT OR IGNORE INTO requests (id, collection_id, folder_id, name, method, url, headers, query_params, body_type, body_content, sort_order, extract_rules) VALUES
('r-ds-health', 'col-text', 'f-deepseek', '健康检查', 'POST',
 'https://train-backend-test.eigenai.com/api/v1/chat/completions',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true}]',
 '[]', 'json',
 '{"model":"deepseek-v31","messages":[{"role":"user","content":"Health check. Please return ok."}],"max_tokens":50,"stream":false}',
 1, '[]'),

('r-ds-stream', 'col-text', 'f-deepseek', '流式健康检查', 'POST',
 'https://train-backend-test.eigenai.com/api/v1/chat/completions',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true}]',
 '[]', 'json',
 '{"model":"deepseek-v31","messages":[{"role":"user","content":"Health check. Please return ok."}],"max_tokens":50,"stream":true}',
 2, '[]'),

('r-ds-playground', 'col-text', 'f-deepseek', 'Playground 路由', 'POST',
 'https://train-backend-test.eigenai.com/api/deepseek-v31',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true}]',
 '[]', 'json',
 '{"model":"deepseek-v31","messages":[{"role":"user","content":"Health check. Please return ok."}],"max_tokens":50,"stream":true}',
 3, '[]');

-- ======= Qwen3 8B 请求 =======
INSERT OR IGNORE INTO requests (id, collection_id, folder_id, name, method, url, headers, query_params, body_type, body_content, sort_order, extract_rules) VALUES
('r-qwen3-health', 'col-text', 'f-qwen3-8b', '健康检查', 'POST',
 'https://train-backend-test.eigenai.com/api/v1/chat/completions',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true}]',
 '[]', 'json',
 '{"model":"qwen3-8b-fp8","messages":[{"role":"user","content":"Health check. Please return ok."}],"max_tokens":50,"stream":false}',
 1, '[]'),

('r-qwen3-stream', 'col-text', 'f-qwen3-8b', '流式健康检查', 'POST',
 'https://train-backend-test.eigenai.com/api/v1/chat/completions',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true}]',
 '[]', 'json',
 '{"model":"qwen3-8b-fp8","messages":[{"role":"user","content":"Health check. Please return ok."}],"max_tokens":50,"stream":true}',
 2, '[]'),

('r-qwen3-temp0', 'col-text', 'f-qwen3-8b', '温度为0', 'POST',
 'https://train-backend-test.eigenai.com/api/v1/chat/completions',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true}]',
 '[]', 'json',
 '{"model":"qwen3-8b-fp8","messages":[{"role":"user","content":"What is 1+1? Answer with just the number."}],"max_tokens":10,"temperature":0.0,"stream":false}',
 3, '[]');

-- ======= GLM-5 请求 =======
INSERT OR IGNORE INTO requests (id, collection_id, folder_id, name, method, url, headers, query_params, body_type, body_content, sort_order, extract_rules) VALUES
('r-glm5-health', 'col-text', 'f-glm5', '健康检查', 'POST',
 'https://train-backend-test.eigenai.com/api/v1/chat/completions',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true}]',
 '[]', 'json',
 '{"model":"glm5","messages":[{"role":"user","content":"Health check. Please return ok."}],"max_tokens":50,"stream":false}',
 1, '[]'),

('r-glm5-stream', 'col-text', 'f-glm5', '流式健康检查', 'POST',
 'https://train-backend-test.eigenai.com/api/v1/chat/completions',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true}]',
 '[]', 'json',
 '{"model":"glm5","messages":[{"role":"user","content":"Health check. Please return ok."}],"max_tokens":50,"stream":true}',
 2, '[]');

-- ======= Higgs Audio V2.5 TTS 请求 =======
INSERT OR IGNORE INTO requests (id, collection_id, folder_id, name, method, url, headers, query_params, body_type, body_content, sort_order, extract_rules) VALUES
('r-higgs-basic', 'col-audio', 'f-higgs-tts', 'TTS 基础检查', 'POST',
 'https://train-backend-test.eigenai.com/api/v1/generate',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true}]',
 '[]', 'json',
 '{"model":"higgs2p5","text":"Hello, this is a test.","voice":"Linda","sampling":{"temperature":0.85,"top_p":0.95,"top_k":50}}',
 1, '[]'),

('r-higgs-stream', 'col-audio', 'f-higgs-tts', 'TTS 流式', 'POST',
 'https://train-backend-test.eigenai.com/api/v1/generate',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true}]',
 '[]', 'json',
 '{"model":"higgs2p5","text":"Hello, this is a test.","voice":"Linda","sampling":{"temperature":0.85,"top_p":0.95,"top_k":50},"stream":true}',
 2, '[]'),

('r-higgs-prod', 'col-audio', 'f-higgs-tts', '线上真实请求', 'POST',
 'https://train-backend-test.eigenai.com/api/v1/generate',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true}]',
 '[]', 'json',
 '{"model":"higgs2p5","text":"The weather today is sunny with a chance of rain in the afternoon.","voice":"Linda"}',
 3, '[]'),

('r-higgs-playground', 'col-audio', 'f-higgs-tts', 'Playground 路由', 'POST',
 'https://train-backend-test.eigenai.com/api/higgs2p5',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true}]',
 '[]', 'json',
 '{"text":"The weather today is sunny with a chance of rain in the afternoon.","voice":"Linda"}',
 4, '[]'),

('r-higgs-err', 'col-audio', 'f-higgs-tts', '错误: 缺少text (400)', 'POST',
 'https://train-backend-test.eigenai.com/api/v1/generate',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true}]',
 '[]', 'json',
 '{"model":"higgs2p5","voice":"Linda"}',
 5, '[]');

-- ======= Higgs TTS 自定义音色 (请求链) =======
INSERT OR IGNORE INTO requests (id, collection_id, folder_id, name, method, url, headers, query_params, body_type, body_content, sort_order, extract_rules) VALUES
('r-higgs-upload', 'col-audio', 'f-higgs-tts-chain', 'Step1: 上传音色', 'POST',
 'https://train-backend-test.eigenai.com/api/higgs2p5/upload_voice',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true}]',
 '[]', 'json',
 '{"note":"实际应为 multipart/form-data 上传 voice_reference_file，此处简化为 JSON 示意"}',
 1, '[{"var_name":"voice_id","source":"json_body","expression":"$.voice_id"}]'),

('r-higgs-custom-tts', 'col-audio', 'f-higgs-tts-chain', 'Step2: 使用自定义音色TTS', 'POST',
 'https://train-backend-test.eigenai.com/api/higgs2p5',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true}]',
 '[]', 'json',
 '{"text":"The weather today is sunny with a chance of rain in the afternoon.","voice_id":"{{voice_id}}"}',
 2, '[]');

-- ======= Whisper V3 Turbo ASR 请求 =======
INSERT OR IGNORE INTO requests (id, collection_id, folder_id, name, method, url, headers, query_params, body_type, body_content, sort_order, extract_rules) VALUES
('r-whisper-health', 'col-audio', 'f-whisper', 'ASR 基础检查', 'POST',
 'https://train-backend-test.eigenai.com/api/v1/generate',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true}]',
 '[]', 'json',
 '{"note":"实际应为 multipart/form-data 上传 audio 文件 + model=whisper_v3_turbo"}',
 1, '[]'),

('r-whisper-playground', 'col-audio', 'f-whisper', 'Playground 路由', 'POST',
 'https://train-backend-test.eigenai.com/api/asr',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true}]',
 '[]', 'json',
 '{"note":"实际应为 multipart/form-data 上传 audio 文件"}',
 2, '[]');

-- ======= Eigen Image 请求 =======
INSERT OR IGNORE INTO requests (id, collection_id, folder_id, name, method, url, headers, query_params, body_type, body_content, sort_order, extract_rules) VALUES
('r-img-basic', 'col-image', 'f-eigen-img', '基础图像生成', 'POST',
 'https://train-backend-test.eigenai.com/api/v1/generate',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true}]',
 '[]', 'json',
 '{"model":"eigen-image","prompt":"a simple circle","seed":42}',
 1, '[]'),

('r-img-seed', 'col-image', 'f-eigen-img', '固定seed生成', 'POST',
 'https://train-backend-test.eigenai.com/api/v1/generate',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true}]',
 '[]', 'json',
 '{"model":"eigen-image","prompt":"a red square","seed":123}',
 2, '[]'),

('r-img-realtime', 'col-image', 'f-eigen-img', 'Real-Time Search 生成', 'POST',
 'https://train-backend-test.eigenai.com/api/v1/generate',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true}]',
 '[]', 'json',
 '{"model":"eigen-image","prompt":"A labubu stands on the front trunk of 2025 toyota camry SE in white color","seed":42,"real_time":true}',
 3, '[]'),

('r-img-playground', 'col-image', 'f-eigen-img', 'Playground 路由', 'POST',
 'https://train-backend-test.eigenai.com/api/eigen-image',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true}]',
 '[]', 'json',
 '{"note":"实际应为 multipart/form-data, prompt=An astronaut riding a horse, seed=42"}',
 4, '[]'),

('r-img-err', 'col-image', 'f-eigen-img', '错误: 缺少prompt (400)', 'POST',
 'https://train-backend-test.eigenai.com/api/v1/generate',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true}]',
 '[]', 'json',
 '{"model":"eigen-image","seed":42}',
 5, '[]');

-- ======= Wan2.2 I2V 请求 =======
INSERT OR IGNORE INTO requests (id, collection_id, folder_id, name, method, url, headers, query_params, body_type, body_content, sort_order, extract_rules) VALUES
('r-wan-basic', 'col-video', 'f-wan-i2v', '图生视频 (异步)', 'POST',
 'https://train-backend-test.eigenai.com/api/v1/generate',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true}]',
 '[]', 'json',
 '{"model":"wan2p2-i2v-14b-turbo","prompt":"A triangle spinning","infer_steps":"5","seed":"42","image_url":"https://chatbot-images-eigenai.s3.amazonaws.com/tiv2v/images/1765375259456_9d6ro51kmu.jpeg"}',
 1, '[]'),

('r-wan-err', 'col-video', 'f-wan-i2v', '错误: 缺少image_url (400)', 'POST',
 'https://train-backend-test.eigenai.com/api/v1/generate',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true}]',
 '[]', 'json',
 '{"model":"wan2p2-i2v-14b-turbo","prompt":"A triangle spinning"}',
 2, '[]');

-- ======= Wan2.2 Playground 完整流程 (请求链) =======
INSERT OR IGNORE INTO requests (id, collection_id, folder_id, name, method, url, headers, query_params, body_type, body_content, sort_order, extract_rules) VALUES
('r-wan-submit', 'col-video', 'f-wan-i2v-chain', 'Step1: 提交视频任务', 'POST',
 'https://train-backend-test.eigenai.com/api/wan2p2-i2v-14b-turbo',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true}]',
 '[]', 'json',
 '{"prompt":"A beast making a speech","image_url":"https://chatbot-images-eigenai.s3.amazonaws.com/tiv2v/images/1765375259456_9d6ro51kmu.jpeg","infer_steps":"5","seed":"42"}',
 1, '[{"var_name":"task_id","source":"json_body","expression":"$.task_id"}]'),

('r-wan-poll', 'col-video', 'f-wan-i2v-chain', 'Step2: 轮询任务状态', 'GET',
 'https://train-backend-test.eigenai.com/api/wan2p2-i2v-14b-turbo-status?jobId={{task_id}}',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true}]',
 '[]', 'none', '', 2, '[]'),

('r-wan-result', 'col-video', 'f-wan-i2v-chain', 'Step3: 获取视频结果', 'GET',
 'https://train-backend-test.eigenai.com/api/wan2p2-i2v-14b-turbo-result?jobId={{task_id}}',
 '[{"key":"Authorization","value":"Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb","enabled":true}]',
 '[]', 'none', '', 3, '[]');

-- ======= 断言 =======
-- Llama 健康检查断言
INSERT OR IGNORE INTO assertions (id, request_id, type, expression, operator, expected, enabled, sort_order) VALUES
('a-llama-h-200', 'r-llama-health', 'status_code', '', 'eq', '200', 1, 1),
('a-llama-h-body', 'r-llama-health', 'json_path', '$.choices[0].message.content', 'exists', '', 1, 2),

('a-llama-s-200', 'r-llama-stream', 'status_code', '', 'eq', '200', 1, 1),
('a-llama-sys-200', 'r-llama-system', 'status_code', '', 'eq', '200', 1, 1),
('a-llama-t0-200', 'r-llama-temp0', 'status_code', '', 'eq', '200', 1, 1),
('a-llama-poem-200', 'r-llama-poem', 'status_code', '', 'eq', '200', 1, 1),
('a-llama-usage-200', 'r-llama-usage', 'status_code', '', 'eq', '200', 1, 1),
('a-llama-pg-200', 'r-llama-playground', 'status_code', '', 'eq', '200', 1, 1),

-- 错误断言
('a-llama-e1-400', 'r-llama-err-empty', 'status_code', '', 'eq', '400', 1, 1),
('a-llama-e2-400', 'r-llama-err-missing', 'status_code', '', 'eq', '400', 1, 1),

-- DeepSeek 断言
('a-ds-h-200', 'r-ds-health', 'status_code', '', 'eq', '200', 1, 1),
('a-ds-s-200', 'r-ds-stream', 'status_code', '', 'eq', '200', 1, 1),
('a-ds-pg-200', 'r-ds-playground', 'status_code', '', 'eq', '200', 1, 1),

-- Qwen3 断言
('a-qwen3-h-200', 'r-qwen3-health', 'status_code', '', 'eq', '200', 1, 1),
('a-qwen3-s-200', 'r-qwen3-stream', 'status_code', '', 'eq', '200', 1, 1),
('a-qwen3-t0-200', 'r-qwen3-temp0', 'status_code', '', 'eq', '200', 1, 1),

-- GLM-5 断言
('a-glm5-h-200', 'r-glm5-health', 'status_code', '', 'eq', '200', 1, 1),
('a-glm5-s-200', 'r-glm5-stream', 'status_code', '', 'eq', '200', 1, 1),

-- Higgs TTS 断言
('a-higgs-b-200', 'r-higgs-basic', 'status_code', '', 'eq', '200', 1, 1),
('a-higgs-s-200', 'r-higgs-stream', 'status_code', '', 'eq', '200', 1, 1),
('a-higgs-p-200', 'r-higgs-prod', 'status_code', '', 'eq', '200', 1, 1),
('a-higgs-pg-200', 'r-higgs-playground', 'status_code', '', 'eq', '200', 1, 1),
('a-higgs-e-400', 'r-higgs-err', 'status_code', '', 'eq', '400', 1, 1),

-- Chain 断言
('a-higgs-up-200', 'r-higgs-upload', 'status_code', '', 'eq', '200', 1, 1),
('a-higgs-ct-200', 'r-higgs-custom-tts', 'status_code', '', 'eq', '200', 1, 1),

-- Whisper 断言
('a-wh-h-200', 'r-whisper-health', 'status_code', '', 'eq', '200', 1, 1),

-- Image 断言
('a-img-b-200', 'r-img-basic', 'status_code', '', 'eq', '200', 1, 1),
('a-img-s-200', 'r-img-seed', 'status_code', '', 'eq', '200', 1, 1),
('a-img-rt-200', 'r-img-realtime', 'status_code', '', 'eq', '200', 1, 1),
('a-img-pg-200', 'r-img-playground', 'status_code', '', 'eq', '200', 1, 1),
('a-img-e-400', 'r-img-err', 'status_code', '', 'eq', '400', 1, 1),

-- Video 断言
('a-wan-b-200', 'r-wan-basic', 'status_code', '', 'eq', '200', 1, 1),
('a-wan-e-400', 'r-wan-err', 'status_code', '', 'eq', '400', 1, 1),
('a-wan-sub-200', 'r-wan-submit', 'status_code', '', 'eq', '200', 1, 1),
('a-wan-poll-200', 'r-wan-poll', 'status_code', '', 'eq', '200', 1, 1),
('a-wan-res-200', 'r-wan-result', 'status_code', '', 'eq', '200', 1, 1);

-- 添加响应时间断言（健康检查应在30秒内返回）
INSERT OR IGNORE INTO assertions (id, request_id, type, expression, operator, expected, enabled, sort_order) VALUES
('a-llama-h-time', 'r-llama-health', 'response_time', '', 'lt', '30000', 1, 3),
('a-ds-h-time', 'r-ds-health', 'response_time', '', 'lt', '30000', 1, 2),
('a-qwen3-h-time', 'r-qwen3-health', 'response_time', '', 'lt', '30000', 1, 2),
('a-glm5-h-time', 'r-glm5-health', 'response_time', '', 'lt', '30000', 1, 2);
