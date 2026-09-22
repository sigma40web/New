[회차 계약]
{{chapter_contract}}

[장면 계획 — 이번 회차; 장면 {{scene_no}} 작성]
{{scene_plan}}

[정사 상태 — 참여자에게 현재 알려진 사실]
{{canon_state}}

[지식 — 참여자별 앎 / 모름 / 잘못된 믿음 / 의심]
{{knowledge_lists}}

[말높이·호칭 요약]
{{register_digests}}

[열린 약속(복선) — 만기 또는 활성]
{{open_promises}}

[이전 텍스트 — 원문 그대로; 여기서 이어 쓴다]
{{previous_text}}

장면 {{scene_no}}을 지금 쓴다(목표 {{length_target_words}}자).

{{identity_tail}}

[출력 스키마 — 이 JSON 필드를 반환한다. length와 paragraphs는 워크플로가 원문에서 다시 계산한다]
{"scene_no": 1, "language": "ko", "text": "장면 원문 (문단은 빈 줄로 구분)", "speaker_annotations": [{"paragraph_id": "p3", "speaker": "화자", "addressee": "청자", "register_shift": "none"}], "claims": [{"paragraph_id": "p3", "text": "사실을 담은 문장 원문", "kind": "event|state|knowledge", "entity_ids": ["..."]}], "system_blocks": ["상태창 등 장치 원문 (있다면)"], "writer_notes": ["..."]}