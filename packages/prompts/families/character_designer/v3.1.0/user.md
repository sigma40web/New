[스토리 스펙]
{{story_spec}}

[선택된 콘셉트]
{{concept}}

[캐스트 브리프]
{{cast_brief}}

[출력 스키마 — 이 JSON 필드를 반환한다. 엔티티 id는 워크플로가 이름에서 만든다]
{"characters": [{"display_name": "한글 이름", "role": "protagonist|antagonist|ally|mentor|love_interest|foil", "age_at_start": 18, "background": "...", "goals": ["..."], "flaws": ["..."], "secrets": [{"statement": "비밀 명제", "known_by": ["아는 인물 이름"], "reveal_not_before_chapter": 30}], "arc": {"start_state": "...", "end_state": "...", "turning_points": [{"description": "...", "chapter_from": 40, "chapter_to": 45}]}, "voice_notes": ["말투: ~요체, 말끝을 흐림", "말버릇: ..."], "short_forms": ["약칭"], "aliases": ["별칭"], "rank": "등급 또는 신분", "registers": [{"toward": "상대 인물 이름", "type": "mentor|rival|superior|subordinate|equal", "formality": 3, "deference": 3, "familiarity": 1, "directness": 2, "contractions": "neutral", "address_terms": ["호칭"]}]}], "propositions": [{"statement": "명제", "kind": "fact|belief|secret", "secret": {"owner_names": ["..."], "reveal_not_before_chapter": 30}, "entity_names": ["관련 인물 이름"]}]}