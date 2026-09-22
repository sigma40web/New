[스토리 스펙]
{{story_spec}}

[시리즈 청사진]
{{blueprint}}

[설계할 시즌]
{{season}}

[리듬 골격 — 결정적 권장안]
{{skeleton}}

[설정 요약]
{{bible_summary}}

전체 회차 수: {{target_chapters}}

이 시즌의 회차별 설계표를 만든다.

[출력 스키마 — 이 JSON 필드를 반환한다]
{"arcs": [{"ordinal": 1, "title": "아크 제목", "kind": "introduction|daily|incident|exam|tournament|dungeon|conflict|romance|mystery|war|climax", "from": 1, "to": 12, "purpose": "이 아크가 이야기에서 해내는 일", "climax_chapter": 11, "focus_characters": ["관계 초점 인물 이름"]}], "chapters": [{"chapter_no": 1, "role": "hook|setup|daily|buildup|foreshadow|incident|confrontation|climax|aftermath|reward|relationship|twist|rest", "tension": 3, "beat": "이 회차의 핵심 사건 한 문장", "thread": "main|growth|romance|mystery|rival|daily|world", "payoff": "cider|reveal|emotion|growth|humor|none", "frustration": false, "hook": "cliffhanger|reveal|decision|arrival_of_threat|emotional_peak|quiet_ominous", "focus_character": ""}]}
- chapters에는 시즌의 모든 회차가 순서대로 빠짐없이 들어간다.
- payoff가 none인 회차는 연속 5화를 넘지 않는다. frustration이 true인 회차는 연속 3화를 넘지 않는다. tension 8 이상은 연속 4화를 넘지 않는다.