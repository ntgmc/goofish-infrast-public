package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"sort"
	"time"
)

type target struct {
	Elite       int     `json:"elite"`
	Level       int     `json:"level"`
	Skill       int     `json:"skill"`
	SkillLevel  int     `json:"skillLevel"`
	ModuleID    *string `json:"moduleId"`
	ModuleLevel *int    `json:"moduleLevel"`
	Potential   int     `json:"potential"`
}

type sample struct {
	Target target  `json:"target"`
	Weight float64 `json:"weight"`
}

type module struct {
	Elite int `json:"elite"`
	Level int `json:"level"`
}

type task struct {
	Base     target   `json:"base"`
	Maxima   []int    `json:"maxima"`
	Module   *module  `json:"module"`
	Coverage float64  `json:"coverage"`
	Samples  []sample `json:"samples"`
}

type row struct {
	Target  target `json:"target"`
	Covered []int  `json:"covered"`
}

type request struct {
	Tasks []task `json:"tasks"`
}

type response struct {
	Results  [][]row `json:"results"`
	KernelMS float64 `json:"kernelMs"`
}

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(input io.Reader, output io.Writer) error {
	reader := bufio.NewReader(input)
	encoder := json.NewEncoder(output)
	for {
		line, err := reader.ReadBytes('\n')
		if err != nil && !errors.Is(err, io.EOF) {
			return err
		}
		if len(bytes.TrimSpace(line)) != 0 {
			var req request
			decoder := json.NewDecoder(bytes.NewReader(line))
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&req); err != nil {
				return err
			}
			if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
				return errors.New("expected one JSON request per line")
			}
			if req.Tasks == nil {
				return errors.New("tasks must be an array")
			}
			for i, task := range req.Tasks {
				if err := validate(task); err != nil {
					return fmt.Errorf("task %d: %w", i, err)
				}
			}
			started := time.Now()
			results := make([][]row, len(req.Tasks))
			for i, task := range req.Tasks {
				results[i] = frontier(task)
			}
			if err := encoder.Encode(response{results, float64(time.Since(started).Nanoseconds()) / 1e6}); err != nil {
				return err
			}
		}
		if errors.Is(err, io.EOF) {
			return nil
		}
	}
}

func frontier(task task) []row {
	result := make([]row, 0)
	elites := values(task.Samples, func(t target) int { return t.Elite })
	levels := values(task.Samples, func(t target) int { return t.Level })
	skills := values(task.Samples, func(t target) int { return t.SkillLevel })
	potentials := values(task.Samples, func(t target) int { return t.Potential })
	branchWeight := 0.0
	for _, sample := range task.Samples {
		branchWeight += sample.Weight
	}
	for _, elite := range elites {
		for _, level := range levels {
			for _, skill := range skills {
				for _, potential := range potentials {
					candidate := task.Base
					candidate.Elite, candidate.Level, candidate.SkillLevel, candidate.Potential = elite, level, skill, potential
					maxLevel := 0
					if elite < len(task.Maxima) {
						maxLevel = task.Maxima[elite]
					}
					minElite := candidate.Skill - 1
					if skill > 7 {
						minElite = max(minElite, 2)
					} else if skill > 4 {
						minElite = max(minElite, 1)
					} else {
						minElite = max(minElite, 0)
					}
					if level > maxLevel || elite < minElite || task.Module != nil && (elite < task.Module.Elite || level < task.Module.Level) {
						continue
					}
					dominated := false
					for _, other := range result {
						if covers(candidate, other.Target) {
							dominated = true
							break
						}
					}
					if dominated {
						continue
					}
					covered, weight := make([]int, 0), 0.0
					for i, sample := range task.Samples {
						if covers(candidate, sample.Target) {
							covered = append(covered, i)
							weight += sample.Weight
						}
					}
					if weight/branchWeight+1e-9 >= task.Coverage {
						result = append(result, row{candidate, covered})
					}
				}
			}
		}
	}
	return result
}

func values(samples []sample, field func(target) int) []int {
	seen := make(map[int]bool)
	for _, sample := range samples {
		seen[field(sample.Target)] = true
	}
	result := make([]int, 0, len(seen))
	for value := range seen {
		result = append(result, value)
	}
	sort.Ints(result)
	return result
}

func covers(left, right target) bool {
	return left.Skill == right.Skill && sameModule(left.ModuleID, right.ModuleID) && left.Potential >= right.Potential &&
		(left.Elite > right.Elite || left.Elite == right.Elite && left.Level >= right.Level) && left.SkillLevel >= right.SkillLevel
}

func sameModule(left, right *string) bool {
	return left == nil && right == nil || left != nil && right != nil && *left == *right
}

func validate(task task) error {
	validTarget := func(t target) bool {
		return t.Elite >= 0 && t.Elite <= 2 && t.Level >= 1 && t.Level <= 90 && t.Skill >= 0 && t.Skill <= 3 &&
			t.SkillLevel >= 1 && t.SkillLevel <= 10 && t.Potential >= 1 && t.Potential <= 6 &&
			(t.ModuleID == nil || *t.ModuleID != "") && (t.ModuleLevel == nil || *t.ModuleLevel >= 0 && *t.ModuleLevel <= 3)
	}
	if !validTarget(task.Base) || math.IsNaN(task.Coverage) || task.Coverage <= 0 || task.Coverage > 1 || task.Samples == nil {
		return errors.New("invalid base, coverage or samples")
	}
	for _, level := range task.Maxima {
		if level < 0 || level > 90 {
			return errors.New("invalid maximum level")
		}
	}
	if task.Module != nil && (task.Module.Elite < 0 || task.Module.Elite > 2 || task.Module.Level < 1 || task.Module.Level > 90) {
		return errors.New("invalid module unlock")
	}
	for _, sample := range task.Samples {
		if !validTarget(sample.Target) || sample.Target.Skill != task.Base.Skill || !sameModule(sample.Target.ModuleID, task.Base.ModuleID) ||
			math.IsNaN(sample.Weight) || math.IsInf(sample.Weight, 0) || sample.Weight < 0 {
			return errors.New("invalid sample or mixed skill/module branch")
		}
	}
	return nil
}
