[아크 계획]
{{arc_plan}}

회차 번호: {{chapter_number}}

[리듬 위치 — 페이싱 지도]
{{rhythm_position}}

[직전 회차 요약]
{{previous_chapter_summary}}

[정사 상태]
{{canon_state}}

[지식 상태]
{{knowledge_state}}

[열린 약속(복선)]
{{open_promises}}

[활성 제약]
{{active_constraints}}

목표 분량(글자 수, 공백 포함): {{length_target_words}}

회차 계약을 만든다.

[출력 스키마 — 이 JSON 필드를 반환한다. id, project_id, chapter_number, version, arc_id, season_id, timeline_id, status, pinned, narrative_identity_version_id, active_constraints_ref는 워크플로가 채운다]
{"title": "회차 제목", "purpose": "이 회차가 해내는 일 한 문장", "reader_experience": "독자가 느낄 것", "arc_objective_contribution": "아크 목표에 기여하는 바", "must_happen": [{"id": "MH-1", "kind": "event|revelation|decision|progression|relationship|comedic_beat|required_scene", "description": "반드시 일어날 일", "verifiable_by": "extraction|judge|lexical_marker|human", "entity_ids": ["엔티티 id"]}], "must_not_happen": [{"id": "MNH-1", "description": "일어나면 안 되는 일", "source": "spec|arc|local|content_restriction", "requirement_id": "REQ-003"}], "pov": {"character_id": "엔티티 id", "person": "first|third_limited|third_omniscient"}, "participants": [{"character_id": "엔티티 id", "role_in_chapter": "protagonist|antagonist|ally|foil|cameo|love_interest|mentor|comic_relief", "on_page": true}], "mentioned_only": ["엔티티 id"], "locations": ["엔티티 id"], "story_time": {"start": {"chapter_no": 1, "ordinal": 0, "precision": "exact|approx|unknown"}, "end": {"chapter_no": 1, "ordinal": 999, "precision": "exact|approx|unknown"}, "elapsed_since_previous": "직전 회차 직후"}, "knowledge_deltas": [{"knower": {"kind": "character", "entity_id": "엔티티 id"}, "proposition_id": "기존 명제 id (있을 때만)", "new_proposition": "새 명제 (기존 id가 없을 때만)", "from_stance": "knows|suspects|believes_false|pretends|unaware|forgot|doubts", "to_stance": "knows|suspects|believes_false|pretends|unaware|forgot|doubts", "how": "알게 되는 경로", "channel_kind": "witnessed|told|inferred|read|overheard|deduced|remembered|prior_loop_memory|source_story"}], "state_deltas": [{"entity_id": "엔티티 id", "attribute": "속성", "from": "이전 값", "to": "새 값", "when_in_chapter": "early|middle|late", "description": "..."}], "relationship_deltas": [{"from_id": "엔티티 id", "to_id": "엔티티 id", "axis": "trust|affection|respect|hostility|dependency|type", "direction": "up|down|change", "magnitude": 1, "description": "..."}], "introduces": [{"kind": "character|location|organization|item|ability|term|proposition", "name": "처음 등장하는 이름", "note": "..."}], "setups": [{"promise_id": "열린 약속 id", "how": "어떻게 심거나 진전시키는지", "kind": "open|advance"}], "payoffs": [{"promise_id": "열린 약속 id", "how": "어떻게 회수하는지", "kind": "pay"}], "progression": {"milestone_id": "...", "magnitude": "minor|major", "mechanism": "성장 방식"}, "emotional_movement": {"start": "시작 감정", "peak": "정점", "end": "끝 감정"}, "conflict": {"type": "external|internal|interpersonal|social", "description": "...", "reversal": "..."}, "local_satisfaction": [{"type": "satisfaction|revelation|emotional_step|growth_confirmed|humor_beat", "description": "..."}], "ending_state": "회차가 끝날 때의 상태", "hook": {"type": "cliffhanger|reveal|decision|arrival_of_threat|emotional_peak|quiet_ominous", "description": "절단 장면", "question_raised": "독자에게 남기는 질문"}, "opening": {"type": "continue_cliffhanger|in_medias_res|sharp_dialogue|status_update|time_skip_with_tension", "description": "도입 장면"}, "scene_count": 3, "dialogue_density_target": 0.35, "monologue_density_target": 0.15, "length_target": {"unit": "characters", "value": 5500, "tolerance_ratio": 0.12}, "tone_notes": ["..."], "continuity_risks": [{"description": "...", "mitigation": "..."}], "knowledge_guards": [{"character_id": "엔티티 id", "must_not_know_proposition_ids": ["명제 id"]}], "acceptance_criteria": [{"id": "AC-1", "kind": "deterministic|judge|human", "description": "...", "check_ref": "MH-1"}]}
- 엔티티 id·명제 id·약속 id 자리에는 위 맥락에 적힌 id만 쓴다. 이름을 넣거나 id를 지어내지 않는다. 맞는 id가 없으면 그 항목을 빼거나 new_proposition을 쓴다.
- setups·payoffs는 열린 약속 목록의 id가 있을 때만 쓴다. continuity_anchors는 쓰지 않는다(워크플로가 채운다).
- acceptance_criteria는 must_happen마다 하나씩, check_ref에 그 must_happen id를 적는다.