package main

import (
	"bytes"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestFrontier(t *testing.T) {
	base := target{Elite: 2, Level: 20, Skill: 1, SkillLevel: 7, Potential: 1}
	higherLevel, higherSkill := base, base
	higherLevel.Level = 40
	higherSkill.SkillLevel = 10
	cases := []struct {
		name     string
		task     task
		expected []row
	}{
		{"incomparable targets", task{base, []int{50, 60, 90}, nil, 0.5, []sample{{higherLevel, 1}, {higherSkill, 1}}},
			[]row{{higherSkill, []int{1}}, {higherLevel, []int{0}}}},
		{"joint coverage", task{base, []int{50, 60, 90}, nil, 1, []sample{{higherLevel, 1}, {higherSkill, 1}}},
			[]row{{target{Elite: 2, Level: 40, Skill: 1, SkillLevel: 10, Potential: 1}, []int{0, 1}}}},
		{"coverage tolerance", task{base, []int{50, 60, 90}, nil, 0.5000000005, []sample{{higherLevel, 1}, {higherSkill, 1}}},
			[]row{{higherSkill, []int{1}}, {higherLevel, []int{0}}}},
		{"level cap", task{base, []int{50, 60, 30}, nil, 1, []sample{{higherLevel, 1}}}, []row{}},
		{"module unlock", task{base, []int{50, 60, 90}, &module{2, 60}, 1, []sample{{base, 1}}}, []row{}},
		{"empty", task{base, []int{50, 60, 90}, nil, 0.8, []sample{}}, []row{}},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if actual := frontier(test.task); !reflect.DeepEqual(actual, test.expected) {
				t.Fatalf("got %+v, want %+v", actual, test.expected)
			}
		})
	}
}

func TestCovers(t *testing.T) {
	low := target{Elite: 1, Level: 60, Skill: 1, SkillLevel: 7, Potential: 1}
	high := low
	high.Elite, high.Level = 2, 1
	if !covers(high, low) || covers(low, high) {
		t.Fatal("promotion must reset the level comparison")
	}
	moduleA, moduleB := "mod_x", "mod_x"
	high.ModuleID, low.ModuleID = &moduleA, &moduleB
	if !covers(high, low) {
		t.Fatal("module identity must compare values")
	}
	moduleB = "mod_y"
	if covers(high, low) {
		t.Fatal("different modules must stay in different branches")
	}
}

func TestProtocol(t *testing.T) {
	noModule := 0
	base := target{Elite: 2, Level: 20, Skill: 1, SkillLevel: 7, ModuleLevel: &noModule, Potential: 1}
	input := task{base, []int{50, 60, 90}, nil, 0.8, make([]sample, 2000)}
	for i := range input.Samples {
		input.Samples[i] = sample{base, 1}
	}
	encoded, err := json.Marshal(request{[]task{input}})
	if err != nil {
		t.Fatal(err)
	}
	if len(encoded) <= 64*1024 {
		t.Fatal("test must exercise a frame larger than bufio.Scanner's default limit")
	}
	var output bytes.Buffer
	if err := run(strings.NewReader(string(encoded)+"\n"+string(encoded)), &output); err != nil {
		t.Fatal(err)
	}
	decoder := json.NewDecoder(&output)
	for i := 0; i < 2; i++ {
		var result response
		if err := decoder.Decode(&result); err != nil || !reflect.DeepEqual(result.Results, [][]row{frontier(input)}) {
			t.Fatalf("request %d: %v, %+v", i, err, result)
		}
	}
	for _, bad := range []string{`{}`, `{"tasks":[],"unknown":1}`, `{"tasks":[]} {"tasks":[]}`, `{"tasks":[{}]}`} {
		if err := run(strings.NewReader(bad), &bytes.Buffer{}); err == nil {
			t.Fatalf("accepted invalid request: %s", bad)
		}
	}
	input.Samples[0].Weight = -1
	if err := validate(input); err == nil {
		t.Fatal("accepted a negative weight")
	}
	input.Samples[0].Weight = 1
	input.Samples[0].Target.Skill = 2
	if err := validate(input); err == nil {
		t.Fatal("accepted a mixed skill branch")
	}
}
