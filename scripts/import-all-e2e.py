#!/usr/bin/env python3
"""从 e2e YAML 文件导入所有测试用例到 QAI SQLite 数据库"""

import yaml
import json
import sqlite3
import uuid
import os
import glob

E2E_DIR = "/Users/zs/Workspace/eigenai/llm-trainer-gateway/e2e/cases"
DB_PATH = os.path.expanduser("~/Library/Application Support/com.qai.app/qai.db")
BASE_URL = "https://train-backend-test.eigenai.com"
AUTH_HEADER = "Bearer sk-1c3d45b7_5ec13170fb5a9055377cb5fe42eb2f2de1ab0f056bb99e9444bfa6625cbbbdeb"

def make_headers(extra=None):
    headers = [
        {"key": "Authorization", "value": AUTH_HEADER, "enabled": True},
        {"key": "Content-Type", "value": "application/json", "enabled": True},
        {"key": "X-Metrics-Debug", "value": "true", "enabled": True},
    ]
    if extra:
        headers.extend(extra)
    return json.dumps(headers)

def main():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys=ON")

    # 先清理旧导入的数据（保留手动创建的）
    conn.execute("DELETE FROM collections WHERE id LIKE 'e2e-%'")
    conn.commit()

    stats = {"collections": 0, "requests": 0, "assertions": 0}

    for category_dir in sorted(glob.glob(os.path.join(E2E_DIR, "*"))):
        if not os.path.isdir(category_dir):
            continue
        category = os.path.basename(category_dir)

        for yml_file in sorted(glob.glob(os.path.join(category_dir, "*.yml"))):
            with open(yml_file, "r") as f:
                data = yaml.safe_load(f)

            model_id = data.get("model", "")
            model_name = data.get("name", model_id)
            cat = data.get("category", category)
            subcategory = data.get("subcategory", "")
            default_endpoint = data.get("endpoint", "/api/v1/generate")

            # 创建 collection
            col_id = f"e2e-{model_id}"
            conn.execute(
                "INSERT OR REPLACE INTO collections (id, name, description, category, endpoint, subcategory) VALUES (?, ?, ?, ?, ?, ?)",
                (col_id, model_name, model_id, cat, default_endpoint, subcategory),
            )
            stats["collections"] += 1

            scenarios = data.get("scenarios", [])
            for idx, scenario in enumerate(scenarios):
                sid = scenario.get("id", f"scenario-{idx}")
                desc = scenario.get("description", "")
                expect_status = 200
                if "expect" in scenario:
                    expect_status = scenario["expect"].get("status", 200)

                # 判断是否是 multi-step
                steps = scenario.get("steps")
                if steps:
                    # 创建 chain folder
                    folder_id = f"e2e-f-{model_id}-{sid}"
                    conn.execute(
                        "INSERT OR REPLACE INTO folders (id, collection_id, parent_folder_id, name, sort_order, is_chain) VALUES (?, ?, NULL, ?, ?, 1)",
                        (folder_id, col_id, f"{sid} ({desc})" if desc else sid, idx),
                    )
                    for step_idx, step in enumerate(steps):
                        step_id = step.get("id", f"step-{step_idx}")
                        step_desc = step.get("description", "")
                        step_endpoint = step.get("endpoint_override", default_endpoint)
                        step_method = step.get("method", "POST").upper()
                        step_expect = 200
                        if "expect" in step:
                            step_expect = step["expect"].get("status", 200)

                        # 构建请求体
                        body_content = ""
                        body_type = "none"
                        if "payload" in step:
                            body_content = json.dumps(step["payload"], ensure_ascii=False)
                            body_type = "json"
                        elif "form_data" in step:
                            body_content = json.dumps(step["form_data"], ensure_ascii=False)
                            body_type = "form"
                        elif "multipart_fields" in step:
                            body_content = json.dumps(step["multipart_fields"], ensure_ascii=False)
                            body_type = "json"

                        url = BASE_URL + step_endpoint

                        # Extract rules
                        extract_rules = "[]"
                        if "extract" in step:
                            rules = []
                            for var_name, json_path in step["extract"].items():
                                rules.append({"var_name": var_name, "source": "json_body", "expression": f"$.{json_path}"})
                            extract_rules = json.dumps(rules)

                        req_id = f"e2e-r-{model_id}-{sid}-{step_id}"
                        conn.execute(
                            """INSERT OR REPLACE INTO requests
                            (id, collection_id, folder_id, name, method, url, headers, query_params, body_type, body_content, sort_order, extract_rules, description, expect_status)
                            VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?)""",
                            (req_id, col_id, folder_id, f"Step{step_idx+1}: {step_id}", step_method, url, make_headers(), body_type, body_content, step_idx, extract_rules, step_desc, step_expect),
                        )
                        stats["requests"] += 1

                        # 断言
                        a_id = f"e2e-a-{model_id}-{sid}-{step_id}-status"
                        conn.execute(
                            "INSERT OR REPLACE INTO assertions (id, request_id, type, expression, operator, expected, enabled, sort_order) VALUES (?, ?, 'status_code', '', 'eq', ?, 1, 1)",
                            (a_id, req_id, str(step_expect)),
                        )
                        stats["assertions"] += 1
                else:
                    # 普通单步请求
                    endpoint = scenario.get("endpoint_override", default_endpoint)
                    method = scenario.get("method", "POST").upper()
                    url = BASE_URL + endpoint

                    body_content = ""
                    body_type = "none"
                    if "payload" in scenario:
                        body_content = json.dumps(scenario["payload"], ensure_ascii=False)
                        body_type = "json"
                    elif "form_data" in scenario:
                        body_content = json.dumps(scenario["form_data"], ensure_ascii=False)
                        body_type = "form"
                    elif "multipart_fields" in scenario:
                        body_content = json.dumps(scenario["multipart_fields"], ensure_ascii=False)
                        body_type = "json"

                    # Extract rules
                    extract_rules = "[]"
                    if "extract" in scenario:
                        rules = []
                        for var_name, json_path in scenario["extract"].items():
                            rules.append({"var_name": var_name, "source": "json_body", "expression": f"$.{json_path}"})
                        extract_rules = json.dumps(rules)

                    req_id = f"e2e-r-{model_id}-{sid}"
                    conn.execute(
                        """INSERT OR REPLACE INTO requests
                        (id, collection_id, folder_id, name, method, url, headers, query_params, body_type, body_content, sort_order, extract_rules, description, expect_status)
                        VALUES (?, ?, NULL, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?)""",
                        (req_id, col_id, sid, method, url, make_headers(), body_type, body_content, idx, extract_rules, desc, expect_status),
                    )
                    stats["requests"] += 1

                    # 状态码断言
                    a_id = f"e2e-a-{model_id}-{sid}-status"
                    conn.execute(
                        "INSERT OR REPLACE INTO assertions (id, request_id, type, expression, operator, expected, enabled, sort_order) VALUES (?, ?, 'status_code', '', 'eq', ?, 1, 1)",
                        (a_id, req_id, str(expect_status)),
                    )
                    stats["assertions"] += 1

                    # 如果期望 200，增加 json_path 断言（针对 text chat 模型）
                    if expect_status == 200 and cat == "text" and not scenario.get("stream"):
                        a_id2 = f"e2e-a-{model_id}-{sid}-content"
                        conn.execute(
                            "INSERT OR REPLACE INTO assertions (id, request_id, type, expression, operator, expected, enabled, sort_order) VALUES (?, ?, 'json_path', '$.choices[0].message.content', 'exists', '', 1, 2)",
                            (a_id2, req_id),
                        )
                        stats["assertions"] += 1

                    # 响应时间断言（健康检查）
                    if "health" in sid and expect_status == 200:
                        a_id3 = f"e2e-a-{model_id}-{sid}-time"
                        conn.execute(
                            "INSERT OR REPLACE INTO assertions (id, request_id, type, expression, operator, expected, enabled, sort_order) VALUES (?, ?, 'response_time', '', 'lt', '30000', 1, 3)",
                            (a_id3, req_id),
                        )
                        stats["assertions"] += 1

    conn.commit()

    # 清理之前手动导入的旧数据
    conn.execute("DELETE FROM collections WHERE id LIKE 'col-%'")
    conn.commit()
    conn.close()

    print(f"导入完成:")
    print(f"  Collections (models): {stats['collections']}")
    print(f"  Requests (scenarios): {stats['requests']}")
    print(f"  Assertions:           {stats['assertions']}")

if __name__ == "__main__":
    main()
