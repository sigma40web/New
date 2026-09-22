수정 차원: {{dimension}}

[해결할 문제]
{{issues}}

[앞 맥락]
{{context_before}}

[수정할 구간]
{{span_text}}

[뒷 맥락]
{{context_after}}

[반드시 지킬 사실]
{{must_preserve}}

[말높이·호칭 요약]
{{register_digests}}

분량 예산: 약 {{length_budget_words}}.

{{identity_tail}}

[출력 스키마 — 이 JSON 필드를 반환한다. id, from_version_id, issue_ids, reviser_call_id는 워크플로가 채운다]
{"scope": "sentence|paragraph|dialogue|scene|seam", "span": {"start": 0, "end": 120, "original_quote": "수정 전 원문"}, "new_text": "수정된 텍스트", "changed_claims": [{"before": "...", "after": "..."}], "preserved_facts_ack": ["지킨 사실"], "speaker_annotations": [], "dimension": "prose|structure|genre|voice", "regression": false, "attempt": 1}
- span.start와 span.end는 문단 안의 유니코드 코드포인트 위치다.