[회차 계약]
{{chapter_contract}}

[말높이·호칭 요약]
{{register_digests}}

[직전 회차 마지막 부분]
{{previous_chapter_tail}}

[출력 스키마 — 이 JSON 필드를 반환한다]
{"scenes": [{"scene_no": 1, "objective": "이 장면의 목적", "pov": {"character_id": "엔티티 id", "person": "first|third_limited|third_omniscient"}, "participants": ["엔티티 id"], "location_id": "엔티티 id", "opening_beat_type": "도입 비트", "ending_beat_type": "마무리 비트", "beats": [{"type": "action|dialogue|revelation|decision|emotional|comedic|progression|transition|status_text|cliffhanger", "description": "무슨 일이 일어나는지", "emotional_target": "독자가 느낄 감정", "tags": ["satisfaction|emotion|information|humor|growth|tension"]}], "entry_state": "장면 시작 상태", "exit_state": "장면 끝 상태", "dialogue_density_target": 0.35, "must_not": ["..."], "speaker_pairs": [], "length_target": {"unit": "characters", "value": 1800, "tolerance_ratio": 0.12}}]}
- 장면 수는 회차 계약의 scene_count와 같게 한다. pov·participants·location_id에는 계약에 있는 id만 쓴다.
- speaker_pairs는 빈 배열로 둔다(말높이는 요약에 이미 있다).