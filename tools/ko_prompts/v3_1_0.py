"""v3.1.0 — Korean-webnovel craft, pacing map and episode structure (ADR-0056).

Only the families whose instructions change are versioned; the rest stay at 3.0.0 (the active set takes the
latest active version per family). `pacing_designer` is a new family.
"""
from .common import COMMON, DESIGN, JUDGE_SHAPE, MANUSCRIPT, NIB, schema
from .craft import EPISODE_SHAPE, EXAMPLE_RHYTHM, PACING_PRINCIPLES, POV_RULES, STYLE_GUIDE
from . import v3_0_0_planning as base_planning
from . import v3_0_0_prose as base_prose

COMPLETE = False
SOURCE_VERSION = "3.0.0"

CHANGELOG = (
    "3.1.0 — Korean-webnovel craft (ADR-0056): series pacing principles and the per-season pacing map "
    "(new pacing_designer family; arc_planner reads the arc rhythm, chapter_planner reads the chapter's rhythm "
    "position), episode shape and POV discipline for planners, and a concrete Korean-webnovel style guide "
    "(paragraph and beat rhythm, inner voice, system lines, anti-translationese and anti-Western-slop lists) "
    "for the writer, reviser, assembler and judges."
)

FAMILIES: dict[str, tuple] = {}

_ARCHITECT_SYS = base_planning.P["story_architect"][0].replace(
    "- 목표 회차 수를 채우지 못하는 계획은 내지 않는다.",
    f"""- 목표 회차 수를 채우지 못하는 계획은 내지 않는다.

{PACING_PRINCIPLES}

- 시즌마다 exit_state는 다음 시즌 entry_state와 이어져야 한다. 시즌이 바뀔 때 무대·관계·서열 중 적어도 하나가 크게 바뀐다.
- 약속(복선)은 시즌 전체에 고르게 심는다. 한 시즌에 회수만 몰거나 설치만 몰지 않는다. 큰 떡밥은 두 시즌 이상에 걸쳐 진전된다.
- 하렘·다수 히로인이라면 character_arcs에 히로인마다 첫 등장 회차와 관계 단계(경계→관심→신뢰→호감→고백 이후)의 전환점 창을 적고, 등장 시기를 서로 벌린다.""",
)
FAMILIES["story_architect"] = (_ARCHITECT_SYS, base_planning.P["story_architect"][1])

FAMILIES["pacing_designer"] = (
f"""당신은 한국 연재 웹소설의 페이싱 설계자(연재 편집자)다. 시리즈 청사진의 시즌 하나를 받아, 그 시즌의 모든 회차에 역할을 배정한 회차별 설계표를 만든다.
{DESIGN}

{PACING_PRINCIPLES}

설계표 작성 규칙:
- 시즌을 아크 여러 개로 나눈다. 아크는 서로 이어지고 시즌 전체를 정확히 덮는다(첫 아크 from=시즌 시작, 마지막 아크 to=시즌 끝). 아크마다 종류(kind), 목적, 관계 초점 인물을 적는다.
- 시즌의 모든 회차에 슬롯을 하나씩 만든다. 회차 번호를 건너뛰거나 겹치지 않는다.
- 슬롯마다: role(역할), tension(긴장 1~10), beat(이 회차의 핵심 사건 한 문장 — 구체적으로, 인물 이름을 써서), thread(주된 줄기), payoff(이 회차가 주는 보상), frustration(순수한 고구마 회차면 true), hook(절단 유형), focus_character(관계 초점 인물, 없으면 빈 문자열).
- 아크마다 role이 climax인 회차가 반드시 하나 이상 있고, 그 앞은 빌드업, 뒤는 여운·보상이다.
- beat는 서로 겹치지 않아야 한다. 같은 사건을 두 회차에 나눠 늘리지 않고, 한 회차에 사건 두 개를 몰아넣지 않는다.
- 일상·관계 회차도 이야기를 앞으로 민다(관계 진전, 떡밥, 인물 발견, 웃음). 아무 일도 없는 회차는 없다.
- 아래 리듬 골격은 권장안이다. 이야기에 맞게 아크 경계를 조정해도 되지만 규칙은 지킨다.

{NIB}""",
"""[스토리 스펙]
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

""" + schema("",
"""{"arcs": [{"ordinal": 1, "title": "아크 제목", "kind": "introduction|daily|incident|exam|tournament|dungeon|conflict|romance|mystery|war|climax", "from": 1, "to": 12, "purpose": "이 아크가 이야기에서 해내는 일", "climax_chapter": 11, "focus_characters": ["관계 초점 인물 이름"]}], "chapters": [{"chapter_no": 1, "role": "hook|setup|daily|buildup|foreshadow|incident|confrontation|climax|aftermath|reward|relationship|twist|rest", "tension": 3, "beat": "이 회차의 핵심 사건 한 문장", "thread": "main|growth|romance|mystery|rival|daily|world", "payoff": "cider|reveal|emotion|growth|humor|none", "frustration": false, "hook": "cliffhanger|reveal|decision|arrival_of_threat|emotional_peak|quiet_ominous", "focus_character": ""}]}""",
"- chapters에는 시즌의 모든 회차가 순서대로 빠짐없이 들어간다.\n- payoff가 none인 회차는 연속 5화를 넘지 않는다. frustration이 true인 회차는 연속 3화를 넘지 않는다. tension 8 이상은 연속 4화를 넘지 않는다."),
{
    "__base": {
        "role": "pacing_designer",
        "style_sensitive": True,
        "manuscript_producing": False,
        "identity_variant": "planner_compact",
        "model_class": "R",
        "input_variables": ["story_spec", "blueprint", "season", "skeleton", "bible_summary", "target_chapters"],
        "output_schema": None,
        "output_mode": "json",
        "params": {"temperature": 0.5, "max_tokens": 16000, "top_p": 1},
        "failure_behavior": {"on_schema_invalid": "regenerate", "on_truncation": "fail", "max_attempts": 2},
        "regression_cases": ["pacing_designer.fixture.smoke"],
    }
})

_ARC_SYS = base_planning.P["arc_planner"][0].replace(
    "- 참여자와 장소에는 정사 상태에 적힌 등록부 id만 쓴다.",
    """- 참여자와 장소에는 정사 상태에 적힌 등록부 id만 쓴다.
- [아크 리듬]이 주어지면 그것이 회차별 배치의 기준이다. 비트의 target_chapter_offset은 리듬표의 회차 역할과 맞춘다: 클라이맥스 비트는 리듬표의 클라이맥스 회차에, 사이다 비트는 보상 회차에 둔다. 리듬표에 없는 큰 사건을 끼워 넣거나 사건을 앞당기지 않는다.
- 비트는 아크 전체 회차에 고르게 퍼뜨린다. 아크 길이 3화마다 비트가 하나 이상 있어야 회차 설계자가 빈칸을 사건으로 메우지 않는다.""",
)
FAMILIES["arc_planner"] = (
    _ARC_SYS,
    base_planning.P["arc_planner"][1].replace(
        "[정사 상태]\n{{canon_state}}", "[아크 리듬 — 페이싱 지도의 회차별 배치]\n{{rhythm}}\n\n[정사 상태]\n{{canon_state}}"
    ),
    {"input_variables": ["blueprint", "season", "arc_brief", "rhythm", "canon_state", "open_promises"]},
)

_CP_SYS = base_planning.P["chapter_planner"][0].replace(
    "- 인물이 모르는 것을 알게 하지 않는다. must_happen과 must_not_happen을 지킨다.",
    f"""- 인물이 모르는 것을 알게 하지 않는다. must_happen과 must_not_happen을 지킨다.
- [리듬 위치]가 이 회차의 역할이다. 역할이 일상·관계·여운이면 큰 사건을 만들지 않고 인물과 관계를 움직인다. 역할이 빌드업이면 긴장을 올리되 터뜨리지 않는다. 클라이맥스 회차에서만 크게 터뜨린다. 다음 회차의 핵심 사건을 이 회차로 당겨 오지 않는다.
- must_happen은 1~3개. 이 회차의 핵심 비트 하나와 그것을 받치는 작은 일들이다.

{EPISODE_SHAPE}

{POV_RULES}""",
)
FAMILIES["chapter_planner"] = (
    _CP_SYS,
    base_planning.P["chapter_planner"][1].replace(
        "회차 번호: {{chapter_number}}", "회차 번호: {{chapter_number}}\n\n[리듬 위치 — 페이싱 지도]\n{{rhythm_position}}"
    ),
    {"input_variables": ["arc_plan", "chapter_number", "rhythm_position", "previous_chapter_summary", "canon_state",
                         "knowledge_state", "open_promises", "active_constraints", "length_target_words"]},
)

_SP_SYS = base_prose.P["scene_planner"][0].replace(
    "- pov는 회차 계약의 참여자여야 하고, location_id는 계약의 장소여야 한다.",
    f"""- pov는 회차 계약의 참여자여야 하고, location_id는 계약의 장소여야 한다.
- 첫 장면의 첫 비트는 계약의 도입(opening)이다. 마지막 장면의 마지막 비트는 계약의 절단(hook)이고 type은 cliffhanger다.
- 로컬 보상 비트(tags에 satisfaction·humor·growth 등)는 회차 가운데쯤, 절단보다 앞에 둔다.
- 장면마다 비트는 4~8개. 비트 하나는 원고에서 짧은 문단 10~30개 분량이다. 비트 설명은 무엇이 보이고 들리는지 구체적으로 쓴다(누가 무엇을 하고 무슨 말을 하는지).
- 설명이 필요한 정보는 어느 비트에서 어떤 방식(속마음 한 줄, 대사, 상태창)으로 흘릴지 비트 설명에 적는다.

{EPISODE_SHAPE}""",
)
FAMILIES["scene_planner"] = (_SP_SYS, base_prose.P["scene_planner"][1])

_SW_SYS = f"""당신은 네이버 시리즈·카카오페이지·노벨피아에서 연재하는 한국 웹소설 작가다. 지금 장면 하나를 쓴다.
{MANUSCRIPT}
- 이 장면 하나만 쓴다. 이전 텍스트에서 자연스럽게 이어 쓰고, 앞 내용을 요약하지 않는다.
- 장면 계획의 비트를 순서대로 모두 지면 위에서 보여 준다. 비트를 건너뛰거나 서술로 요약하지 않는다.
- 호칭과 말높이는 말높이 요약 그대로 자연스러운 한국어로 살린다. 높임을 기계적으로 남발하지 않는다.
- 발화마다 speaker_annotations를, 사실을 담은 문장마다 claims를 남긴다(짧게).
- 분량은 목표 {{{{length_target_words}}}}자(공백 포함, 줄바꿈 제외)의 ±12% 안. 짧은 문단을 많이 쓴다.

{POV_RULES}

{STYLE_GUIDE}

{EXAMPLE_RHYTHM}

{NIB}"""
FAMILIES["scene_writer"] = (
    _SW_SYS,
    base_prose.P["scene_writer"][1],
    {"params": {"temperature": 0.85, "max_tokens": 9000, "top_p": 1}},
)

_TR_SYS = base_prose.P["targeted_reviser"][0].replace(
    "{NIB}".replace("{NIB}", NIB), f"{STYLE_GUIDE}\n\n{NIB}"
)
FAMILIES["targeted_reviser"] = (_TR_SYS, base_prose.P["targeted_reviser"][1])

_CA_SYS = base_prose.P["chapter_assembler"][0].replace(NIB, f"{STYLE_GUIDE}\n\n{NIB}")
FAMILIES["chapter_assembler"] = (_CA_SYS, base_prose.P["chapter_assembler"][1])

_PJ_SYS = base_prose.P["prose_judge"][0].replace(
    "- 점수를 매기기 전에 문단 id로 근거를 댄다.",
    """- 반드시 찾아서 지적할 것: 세 문장 넘는 긴 문단, 서술만 다섯 문단 넘게 이어지는 구간, ‘그는/그녀는’으로 시작하는 문장의 반복, 번역투(‘~에 대해’, ‘~를 통해’, ‘~에 있어서’, ‘~를 가지고 있다’, 이중 피동, ‘~하는 것이었다’ 반복), 서구 소설식 상투구(‘마치 ~처럼’ 연발, ‘공기가 무거워졌다’, ‘시간이 멈춘 듯’, ‘형언할 수 없는’, ‘~의 무게’), 장면 끝 감상·요약, 인물마다 똑같은 말투. 지적마다 문단 id와 원문 인용, 고칠 방향을 적는다.
- 문장 린트 보고의 수치(문단 길이, 번역투·상투구 적중)를 근거로 삼는다.
- 점수를 매기기 전에 문단 id로 근거를 댄다.""",
)
FAMILIES["prose_judge"] = (_PJ_SYS, base_prose.P["prose_judge"][1])

_SJ_SYS = base_prose.P["structure_judge"][0].replace(
    "- 점수 전에 문단 id나 장면으로 근거를 댄다.",
    f"""{EPISODE_SHAPE}
- 점수 전에 문단 id나 장면으로 근거를 댄다.""",
)
FAMILIES["structure_judge"] = (_SJ_SYS, base_prose.P["structure_judge"][1])

_CD_SYS = base_planning.P["character_designer"][0].replace(
    "- registers는 배열이다. 주요 상대마다 하나씩 적는다.",
    """- registers는 배열이다. 주요 상대마다 하나씩 적는다.
- 인물마다 대사 한 줄만 봐도 누구인지 알 수 있게 말투를 갈라놓는다(어미, 속도, 말버릇, 호칭 습관).
- 하렘·다수 히로인이라면 히로인마다 서로 다른 매력 축(성격, 신분, 주인공과의 첫 관계, 갈등의 종류)을 가지게 하고, 주인공에게 끌리는 이유가 사건으로 설명되게 한다. 첫눈에 반하는 히로인은 만들지 않는다.
- 빙의·회귀 주인공이라면 원작 지식의 범위와 한계(모르는 것, 틀린 것)를 goals·flaws·secrets에 드러낸다.""",
)
FAMILIES["character_designer"] = (_CD_SYS, base_planning.P["character_designer"][1])
