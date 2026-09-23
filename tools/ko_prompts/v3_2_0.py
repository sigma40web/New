"""v3.2.0 — part-scoped bible generation and chapter titles (ADR-0057).

Bible families gain a `{{part}}` variable: the workflow asks for one bounded part of the design per call (a
group of characters, the world's rules then its places, the seasons then the promises, a season's arcs then
20-chapter windows of slots) and merges the parts. Each call stays short enough to finish inside a provider's
response-time cap, and later parts see what earlier parts decided. `chapter_planner` writes a chapter title.
"""
from . import v3_0_0_planning as base_planning
from . import v3_1_0 as v31

COMPLETE = False
SOURCE_VERSION = "3.1.0"

CHANGELOG = (
    "3.2.0 — part-scoped bible generation (ADR-0057): character_designer, world_builder, power_system_designer, "
    "story_architect and pacing_designer read a {{part}} scope and return only that part, so each call is bounded "
    "and later parts build on earlier ones; chapter_planner writes a Korean chapter title."
)

PART_RULE = """- [이번 호출의 범위]가 주어지면 그 범위에 해당하는 필드만 채워서 반환한다. 범위 밖의 배열 필드는 빈 배열 []로, 범위 밖의 문자열·객체 필드는 생략한다.
- 범위에 ‘이미 확정된 내용’이 적혀 있으면 그것과 겹치거나 모순되지 않게 하고, 같은 이름을 다시 설계하지 않는다."""

PART_BLOCK = "[이번 호출의 범위]\n{{part}}\n\n"


def with_part(system: str, user: str, marker: str) -> tuple:
    """Insert the part rule before the identity block and the part block before `marker` in the user template."""
    nib = "{{narrative_identity_block}}"
    assert nib in system and marker in user, marker
    return system.replace(nib, PART_RULE + "\n\n" + nib), user.replace(marker, PART_BLOCK + marker, 1)


FAMILIES: dict = {}


def _add(family, system, user, marker, inputs, source="3.1.0"):
    s, u = with_part(system, user, marker)
    FAMILIES[family] = (s, u, {"input_variables": inputs, "__source": source})


_add("character_designer", v31.FAMILIES["character_designer"][0], v31.FAMILIES["character_designer"][1],
     "[출력 스키마", ["story_spec", "concept", "cast_brief", "part"])
_add("world_builder", base_planning.P["world_builder"][0], base_planning.P["world_builder"][1],
     "[출력 스키마", ["story_spec", "concept", "part"], source="3.0.0")
_add("power_system_designer", base_planning.P["power_system_designer"][0],
     base_planning.P["power_system_designer"][1], "[출력 스키마", ["story_spec", "concept", "world_rules", "part"],
     source="3.0.0")
_add("story_architect", v31.FAMILIES["story_architect"][0], v31.FAMILIES["story_architect"][1],
     "시리즈 청사진을 만든다.", ["story_spec", "concept", "bible_summary", "target_chapters", "part"])

_pd_sys, _pd_user = v31.FAMILIES["pacing_designer"][0], v31.FAMILIES["pacing_designer"][1]
_pd_meta = dict(v31.FAMILIES["pacing_designer"][2]["__base"])
_pd_meta["input_variables"] = ["story_spec", "blueprint", "season", "skeleton", "bible_summary",
                               "target_chapters", "part"]
_s, _u = with_part(_pd_sys, _pd_user, "이 시즌의 회차별 설계표를 만든다.")
FAMILIES["pacing_designer"] = (_s, _u, {"__base": _pd_meta})

_cp_sys, _cp_user, _cp_meta = v31.FAMILIES["chapter_planner"]
_TITLE_RULE = ("- title은 이 회차의 제목이다. 한국어 2~15자, 웹소설 회차 제목 감각(짧고 궁금하게), 스포일러 금지. "
               "예: ‘엑스트라의 첫날’, ‘89일’, ‘원작에 없던 이름’.\n- must_happen은 1~3개.")
FAMILIES["chapter_planner"] = (
    _cp_sys.replace("- must_happen은 1~3개.", _TITLE_RULE),
    _cp_user.replace('{"purpose": "이 회차가 해내는 일 한 문장",',
                     '{"title": "회차 제목", "purpose": "이 회차가 해내는 일 한 문장",'),
    _cp_meta,
)
